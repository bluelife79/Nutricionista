#!/usr/bin/env python3
"""
audit_data.py — Read-only analysis of database.json.
Generates scripts/audit_report.json with stats about data quality issues.
"""

import json
import unicodedata
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "database.json"
REPORT_PATH = ROOT / "scripts" / "audit_report.json"

# ---------------------------------------------------------------------------
# Keyword lists
# ---------------------------------------------------------------------------
CONDIMENT_KEYWORDS = [
    "azafran", "tomillo", "oregano", "pimienta", "canela", "comino", "curry",
    "laurel", "perejil", "cilantro", "sazonador", "especias", "hierbas",
    "mostaza", "vinagre", "curcuma", "jengibre", "nuez moscada",
]

PREPARED_KEYWORDS = [
    "lasana", "paella", "macarrones", "cocido", "estofado", "bolonesa",
    "tortilla de", "croqueta", "hamburguesa preparada", "pizza", "nuggets",
    "empanada",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def normalize(text: str) -> str:
    """Lowercase, strip accents."""
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

    foods = data["foods"]
    total = len(foods)
    print(f"Total foods: {total}")

    # --- mismatches: category != macro_profile ---
    mismatches_list = []
    for food in foods:
        cat = food.get("category")
        mp = food.get("macro_profile")
        if cat != mp:
            mismatches_list.append({
                "id": food.get("id"),
                "name": food.get("name"),
                "category": cat,
                "macro_profile": mp,
            })

    # --- null subgroups ---
    null_subgroups_list = []
    for food in foods:
        if food.get("subgroup") is None:
            null_subgroups_list.append({
                "id": food.get("id"),
                "name": food.get("name"),
                "category": food.get("category"),
            })

    # --- suspicious condiments (no "condiment" flag but matches keywords) ---
    suspicious_condiments_list = []
    for food in foods:
        flags = food.get("flags") or []
        if "condiment" in flags:
            continue
        name_norm = normalize(food.get("name", "")) + " "  # trailing space for "sal "
        if matches_any(name_norm, CONDIMENT_KEYWORDS):
            suspicious_condiments_list.append({
                "id": food.get("id"),
                "name": food.get("name"),
                "category": food.get("category"),
                "flags": flags,
            })

    # --- suspicious prepared (no "prepared" flag but matches keywords) ---
    suspicious_prepared_list = []
    for food in foods:
        flags = food.get("flags") or []
        if "prepared" in flags:
            continue
        name_norm = normalize(food.get("name", ""))
        if matches_any(name_norm, PREPARED_KEYWORDS):
            suspicious_prepared_list.append({
                "id": food.get("id"),
                "name": food.get("name"),
                "category": food.get("category"),
                "flags": flags,
            })

    # --- distributions ---
    category_dist: dict[str, int] = {}
    subgroup_dist: dict[str, int] = {}
    for food in foods:
        cat = food.get("category") or "null"
        category_dist[cat] = category_dist.get(cat, 0) + 1

        sg = food.get("subgroup") or "null"
        subgroup_dist[sg] = subgroup_dist.get(sg, 0) + 1

    # --- Build report ---
    report = {
        "total_items": total,
        "mismatches": {
            "count": len(mismatches_list),
            "items": mismatches_list,
        },
        "null_subgroups": {
            "count": len(null_subgroups_list),
            "items": null_subgroups_list,
        },
        "suspicious_condiments": {
            "count": len(suspicious_condiments_list),
            "items": suspicious_condiments_list,
        },
        "suspicious_prepared": {
            "count": len(suspicious_prepared_list),
            "items": suspicious_prepared_list,
        },
        "category_distribution": dict(sorted(category_dist.items())),
        "subgroup_distribution": dict(sorted(subgroup_dist.items())),
    }

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\nAudit report written to {REPORT_PATH}")
    print(f"  mismatches (category != macro_profile): {report['mismatches']['count']}")
    print(f"  null subgroups:                         {report['null_subgroups']['count']}")
    print(f"  suspicious condiments (missing flag):   {report['suspicious_condiments']['count']}")
    print(f"  suspicious prepared (missing flag):     {report['suspicious_prepared']['count']}")
    print(f"  category distribution: {report['category_distribution']}")
    print(f"  distinct subgroups: {len(subgroup_dist)}")


if __name__ == "__main__":
    main()
