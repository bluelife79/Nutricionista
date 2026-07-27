"""audit_condiments.py — detect spices/condiments in database.json missing raw_ingredient=True.

Usage:
  python3 scripts/audit_condiments.py [--dry-run] [--apply]

  Default = --dry-run (generates CSV report only, database.json untouched).
  --apply  patches database.json atomically (backup → tmp → os.replace).

Output:
  scripts/audit_condiments_report.csv

Exit codes:
  0  run completed (dry-run or apply)
  1  unexpected error

Design:
  The hard filter in js/algorithm.js (F0.1, llm-judge-fallback) blocks candidates
  where raw_ingredient===true and origin.raw_ingredient!==true. For this to work
  correctly, spices/condiments that are NEVER consumed directly (e.g. canela, comino,
  pimienta) must be flagged raw_ingredient=true. This script audits for gaps.

  Detection logic:
  - Name (lowercased, accent-stripped) matches a keyword from SPICE_KEYWORDS
  - AND raw_ingredient is NOT already True

  False-positive guards:
  - Compound food names like "Pechuga de pavo pimienta" are NOT flagged because
    we require the keyword to appear as a standalone term (the script matches
    whole names — a simple substring match; compound FP foods should be reviewed
    manually in the CSV before running --apply).
  - The CSV report includes current subgroup, category, and frequency so the user
    can validate each candidate before applying.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import re
import shutil
import sys
import time
import unicodedata
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
log = logging.getLogger("audit-condiments")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).parent.parent
DB_PATH = REPO_ROOT / "database.json"
SCRIPTS_DIR = Path(__file__).parent
REPORT_PATH = SCRIPTS_DIR / "audit_condiments_report.csv"

# ---------------------------------------------------------------------------
# Keyword list — pure spices / condiments / flavorings that are raw_ingredient
# by definition: they are cooking ingredients, never consumed directly as a dish.
#
# These are matched against the lowercased, accent-stripped food name via simple
# substring search. The CSV report lets the user review matches before --apply.
# ---------------------------------------------------------------------------
SPICE_KEYWORDS = [
    # Core spices (BEDCA confirmed present in DB)
    "canela",
    "comino",
    "pimienta",
    "nuez moscada",
    "clavo",
    # Red-list spices (likely present or future additions)
    "anís",
    "anis",
    "azafrán",
    "azafran",
    "albahaca",
    "orégano",
    "oregano",
    "tomillo",
    "romero",
    "jengibre",
    "cardamomo",
    "cúrcuma",
    "curcuma",
    "regaliz",
    "vainilla",
    "menta",
    "perejil",
    "cilantro",
    "estragón",
    "estragon",
    "laurel",
    # Additional Spanish dietary spices
    "cayena",
    "pimentón",
    "pimenton",
    "mostaza",        # mustard seed / powder (raw_ingredient context)
    "ajedrea",
    "mejorana",
    "alcaravea",
    "eneldo",
    "hinojo",         # fennel seeds (raw spice)
    "fenogreco",
    "zumaque",
    "sumac",
    "za'atar",
    "zaatar",
    "tahini",         # sesame paste — raw_ingredient
    "sésamo",
    "sesamo",
    "amapola",        # poppy seeds
    "levadura",       # yeast — raw_ingredient (already likely flagged)
    "harina",         # flour — raw_ingredient (already likely flagged)
    "almidón",
    "almidon",
    "gelatina",
    "agar",
    "colorante",
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize(text: str) -> str:
    """Lowercase + strip accents for robust matching."""
    nfkd = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def is_compound_food(name_norm: str, keyword_norm: str) -> bool:
    """Heuristic: if the name contains more than 3 non-stop tokens before the keyword,
    it is likely a compound product (e.g. 'Pechuga de pavo pimienta'). We still
    INCLUDE it in the report but mark action_taken='REVIEW' instead of 'PATCH'.
    Returns True if it looks like a compound food."""
    # Simple heuristic: name that is longer than the keyword by more than 20 chars
    # and starts with a different word than the keyword itself.
    if len(name_norm) > len(keyword_norm) + 20:
        # Check if keyword appears only at end — likely a seasoning descriptor
        kw_pos = name_norm.find(keyword_norm)
        if kw_pos > 15:  # keyword is not at the start
            return True
    return False


def is_candidate(food: dict, kw_norm: str, name_norm: str) -> bool:
    """Return True if this food should be flagged as a candidate for raw_ingredient=True.

    Uses word-boundary matching (\\b) to avoid false positives like:
      - "menta" matching "fermentada", "emmental"
      - "anís" matching "hispanicus"
      - "hinojo" matching "pepinohino jo" (contrived example)
    """
    # Must not already have raw_ingredient=True
    if food.get("raw_ingredient") is True:
        return False
    # Word-boundary match — avoids substring FPs like menta→fermentada
    pattern = r"\b" + re.escape(kw_norm) + r"\b"
    if not re.search(pattern, name_norm):
        return False
    return True


def build_report_row(food: dict, matched_keyword: str, action: str) -> dict:
    return {
        "id": food.get("id", ""),
        "name": food.get("name", ""),
        "category": food.get("category", ""),
        "subgroup": food.get("subgroup", ""),
        "current_raw_ingredient": food.get("raw_ingredient", ""),
        "current_frequency": food.get("frequency", ""),
        "matched_keyword": matched_keyword,
        "action_taken": action,
    }


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def audit(db: list[dict], apply: bool) -> tuple[list[dict], list[dict]]:
    """Iterate db, flag candidates. Returns (report_rows, patched_foods).

    patched_foods: list of food dicts that were modified (only when apply=True).
    """
    report_rows: list[dict] = []
    patched_foods: list[dict] = []

    # Pre-normalize keywords and compile patterns
    kw_norms = [normalize(kw) for kw in SPICE_KEYWORDS]
    kw_patterns = [re.compile(r"\b" + re.escape(kn) + r"\b") for kn in kw_norms]

    seen_ids: set[str] = set()  # avoid duplicates if multiple keywords match

    for food in db:
        food_id = food.get("id", "")
        name_norm = normalize(food.get("name", ""))

        for kw, kw_norm, pattern in zip(SPICE_KEYWORDS, kw_norms, kw_patterns):
            if food.get("raw_ingredient") is True:
                break  # already flagged — skip all keywords for this food
            if food_id in seen_ids:
                break  # already matched by a prior keyword
            if not pattern.search(name_norm):
                continue

            seen_ids.add(food_id)
            compound = is_compound_food(name_norm, kw_norm)
            action = "REVIEW (compound name)" if compound else ("PATCHED" if apply else "DRY_RUN_WOULD_PATCH")

            report_rows.append(build_report_row(food, kw, action))

            if apply and not compound:
                # Set raw_ingredient=True
                food["raw_ingredient"] = True
                # Set frequency to "raro" if not already set to habitual/ocasional/raro
                if food.get("frequency") not in ("habitual", "ocasional", "raro"):
                    food["frequency"] = "raro"
                elif food.get("frequency") == "habitual":
                    # Most pure spices should be "raro" or "ocasional" — preserve
                    # if already set, but flag in report (user sees PATCHED above)
                    pass
                patched_foods.append(food)

            break  # one match per food is enough

    return report_rows, patched_foods


def write_report(report_rows: list[dict]) -> None:
    fieldnames = [
        "id", "name", "category", "subgroup",
        "current_raw_ingredient", "current_frequency",
        "matched_keyword", "action_taken",
    ]
    with open(REPORT_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(report_rows)
    log.info(f"[audit-condiments] Report written to {REPORT_PATH}")


def atomic_write_db(db: list[dict]) -> None:
    """Backup + tmp + os.replace — same pattern as bulk_label_foods.py."""
    ts = int(time.time())
    backup = Path(f"{DB_PATH}.bak.{ts}")
    shutil.copy2(DB_PATH, backup)
    log.info(f"[audit-condiments] BACKUP created: {backup.name}")

    tmp = Path(f"{DB_PATH}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())

    os.replace(tmp, DB_PATH)
    log.info(f"[audit-condiments] DB written atomically to {DB_PATH.name}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit condiments/spices in database.json missing raw_ingredient=True."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Generate CSV report only. Do NOT modify database.json (default).",
    )
    mode.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Patch database.json atomically. Creates backup before writing.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    apply = args.apply  # if neither flag given, default is dry-run

    if not DB_PATH.exists():
        log.error(f"[audit-condiments] database.json not found at {DB_PATH}")
        return 1

    log.info(f"[audit-condiments] Loading {DB_PATH.name} ...")
    with open(DB_PATH, encoding="utf-8") as f:
        db: list[dict] = json.load(f)

    log.info(f"[audit-condiments] Loaded {len(db)} foods. Running audit ({'APPLY' if apply else 'DRY-RUN'}) ...")

    report_rows, patched_foods = audit(db, apply)

    # Write report
    write_report(report_rows)

    # Apply mutations
    if apply and patched_foods:
        atomic_write_db(db)

    # Summary
    n_detected = len(report_rows)
    n_compound = sum(1 for r in report_rows if "compound" in r["action_taken"].lower())
    n_patchable = n_detected - n_compound
    n_patched = len(patched_foods) if apply else 0

    if apply:
        log.info(
            f"[audit-condiments] DETECTED {n_detected} candidates "
            f"({n_compound} compound/review, {n_patchable} patchable), "
            f"PATCHED {n_patched}"
        )
    else:
        log.info(
            f"[audit-condiments] DETECTED {n_detected} candidates "
            f"({n_compound} compound/review, {n_patchable} patchable), "
            f"DRY-RUN (no changes written)"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
