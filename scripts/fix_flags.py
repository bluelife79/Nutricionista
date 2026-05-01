#!/usr/bin/env python3
"""
fix_flags.py — Add missing "condiment" and "prepared" flags to database_v3.json.

Rules:
  - Normalize name (lowercase, strip accents)
  - If matches CONDIMENT_KEYWORDS and flag absent → add "condiment"
  - If matches PREPARED_KEYWORDS and flag absent → add "prepared"
  - Never duplicate existing flags

Note: "sal " includes trailing space to avoid matching "salmón", "salsa", etc.

Outputs:
  database_v4.json         — database with corrected flags
  scripts/flags_changelog.json  — {id, name, flags_added}
"""

import copy
import json
import unicodedata
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "database_v3.json"
OUT_DB = ROOT / "database_v4.json"
CHANGELOG_PATH = ROOT / "scripts" / "flags_changelog.json"

# ---------------------------------------------------------------------------
# Keyword lists (already normalized: lowercase, no accents)
# ---------------------------------------------------------------------------
CONDIMENT_KEYWORDS: list[str] = [
    "azafran", "tomillo", "oregano", "pimienta", "canela", "comino", "curry",
    "laurel", "perejil", "cilantro", "sazonador", "especias",
    "hierbas aromaticas", "mostaza", "vinagre", "curcuma", "jengibre",
    "nuez moscada", "paprika", "pimenton", "albahaca", "romero", "eneldo",
    "estragon", "mejorana", "sal ",   # trailing space: matches "sal " not "salmon"
    "caldo en polvo", "extracto de", "colorante",
]

PREPARED_KEYWORDS: list[str] = [
    "lasana", "paella", "macarrones", "cocido", "estofado", "bolonesa",
    "tortilla de", "croqueta", "hamburguesa preparada", "pizza", "nuggets",
    "empanada", "pure preparado", "sopa preparada", "plato preparado",
    "menu", "bocadillo", "gelatina",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def normalize(text: str) -> str:
    """Lowercase and strip combining accents."""
    nfkd = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def matches_any(name_norm: str, keywords: list[str]) -> bool:
    return any(kw in name_norm for kw in keywords)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    print(f"Reading {DB_PATH}...")
    with open(DB_PATH, encoding="utf-8") as f:
        data = json.load(f)

    foods = copy.deepcopy(data["foods"])

    changelog: list[dict] = []
    condiment_added = 0
    prepared_added = 0

    for food in foods:
        name = food.get("name", "")
        # Append space so "sal " keyword doesn't match inside "salmon"
        name_norm = normalize(name) + " "
        flags: list = list(food.get("flags") or [])
        flags_added: list[str] = []

        if matches_any(name_norm, CONDIMENT_KEYWORDS) and "condiment" not in flags:
            flags.append("condiment")
            flags_added.append("condiment")
            condiment_added += 1

        if matches_any(name_norm, PREPARED_KEYWORDS) and "prepared" not in flags:
            flags.append("prepared")
            flags_added.append("prepared")
            prepared_added += 1

        if flags_added:
            food["flags"] = flags
            changelog.append({
                "id": food.get("id"),
                "name": name,
                "flags_added": flags_added,
            })

    # --- Write outputs ---
    data_out = {"foods": foods}
    with open(OUT_DB, "w", encoding="utf-8") as f:
        json.dump(data_out, f, ensure_ascii=False, indent=2)

    CHANGELOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CHANGELOG_PATH, "w", encoding="utf-8") as f:
        json.dump(changelog, f, ensure_ascii=False, indent=2)

    print(f"Flags added — condiment: {condiment_added}, prepared: {prepared_added}")
    print(f"Items modified: {len(changelog)}")
    print(f"  database_v4.json written")
    print(f"  flags_changelog.json: {len(changelog)} entries")


if __name__ == "__main__":
    main()
