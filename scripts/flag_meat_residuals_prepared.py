#!/usr/bin/env python3
"""
flag_meat_residuals_prepared.py — Flag the 22 residual foods in subgroup=meat
that are clearly prepared dishes (multi-ingredient names) but lack the
'prepared' flag, so they get T3 instead of T1 in the algorithm.

Idempotent. Creates database.json.bak.<unix_ts> before writing.
"""

import json
import re
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "database.json"

# Markers that indicate a multi-ingredient prepared dish.
PREPARED_MARKERS = re.compile(
    r"\b(con|y|sabor a|sabor|salsa|al curry|tikka|barbacoa|chinos?|"
    r"calzone|noodles|fideos|gnocchi|salteado|braseado|parrillada|"
    r"yakisoba|tarrito|crema)\b",
    re.IGNORECASE,
)


def main():
    with open(DB_PATH) as fh:
        db = json.load(fh)
    foods = db if isinstance(db, list) else db.get("foods", db)

    targets = [f for f in foods if f.get("subgroup") == "meat"]
    print(f"Foods with subgroup=meat (residual): {len(targets)}")

    changed = []
    skipped = []
    for f in targets:
        flags = list(f.get("flags") or [])
        if "prepared" in flags:
            continue  # already flagged
        if PREPARED_MARKERS.search(f.get("name", "")):
            flags.append("prepared")
            f["flags"] = flags
            changed.append(f.get("name", "")[:60])
        else:
            skipped.append(f.get("name", "")[:60])

    print(f"\nFlagged as prepared: {len(changed)}")
    print(f"Left untouched (no marker matched): {len(skipped)}")

    if not changed:
        print("\nNo-op (idempotent). Exiting.")
        return

    backup = DB_PATH.with_suffix(f".json.bak.{int(time.time())}")
    shutil.copy(DB_PATH, backup)
    print(f"\nBackup: {backup.name}")

    with open(DB_PATH, "w", encoding="utf-8") as fh:
        json.dump(db, fh, ensure_ascii=False, indent=2)
    print(f"Wrote {DB_PATH.name}")

    print("\nFlagged sample:")
    for name in changed[:20]:
        print(f"  + {name}")
    if skipped:
        print("\nSkipped (kept as T1, no prepared marker):")
        for name in skipped[:10]:
            print(f"  - {name}")


if __name__ == "__main__":
    main()
