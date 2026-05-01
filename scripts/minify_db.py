#!/usr/bin/env python3
"""
minify_db.py — Minify database_v4.json → database.min.json.
Strips all whitespace from JSON output.
"""

import json
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "database.json"
OUT_PATH = ROOT / "database.min.json"


def main() -> None:
    print(f"Reading {DB_PATH}...")
    with open(DB_PATH, encoding="utf-8") as f:
        data = json.load(f)

    foods = data.get("foods", [])
    original_size = DB_PATH.stat().st_size

    minified = json.dumps(data, separators=(",", ":"), ensure_ascii=False)

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(minified)

    minified_size = OUT_PATH.stat().st_size
    ratio = (1 - minified_size / original_size) * 100 if original_size else 0

    print(f"Original size:  {original_size:,} bytes")
    print(f"Minified size:  {minified_size:,} bytes")
    print(f"Reduction:      {ratio:.1f}%")
    print(f"Foods count:    {len(foods)}")
    print(f"  database.min.json written")


if __name__ == "__main__":
    main()
