#!/usr/bin/env python3
"""
scripts/fix_plant_protein_categorization.py

Re-categoriza alimentos de proteína vegetal (tofu, tempeh, seitán, soja
texturizada, heura) que están mal etiquetados en la BD como dairy/
other_dairy. Caso disparador (Hugo mail 16/05/2026 punto 2.E):
  - Tofu BEDCA → category=dairy, subgroup=other_dairy ❌
  - "tofu no debería abrir con chanquete, ostras, mejillones o pijota"

Reasigna a category=protein, subgroup=plant_protein. Idempotente.

Uso:
  python3 scripts/fix_plant_protein_categorization.py            # dry-run
  python3 scripts/fix_plant_protein_categorization.py --apply    # escribe
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "database.json"

# Regex: tokens que identifican proteína vegetal pura.
# NOT "tofu silken con frutos secos" (eso es snack), pero SÍ "Tofu firme".
_PLANT_PROTEIN_RE = re.compile(
    r"^(tofu|tempeh|seit[áa]n|soja\s+text(?:urizada|urada)?|"
    r"soja\s+desh(?:idratada|idr)|soja\s+granul|heura|prote[íi]na\s+vegetal\s+texturizada"
    r")\b",
    re.IGNORECASE,
)


def is_plant_protein(food: dict) -> bool:
    """True si el alimento es proteína vegetal pura por nombre."""
    name = (food.get("name") or "").strip().lower()
    return bool(_PLANT_PROTEIN_RE.match(name))


def main(apply: bool) -> int:
    with DB_PATH.open(encoding="utf-8") as f:
        foods = json.load(f)

    fixes = []
    for food in foods:
        if not is_plant_protein(food):
            continue
        cat = food.get("category")
        sub = food.get("subgroup")
        # Solo arreglar si NO está ya en protein/plant_protein
        if cat == "protein" and sub == "plant_protein":
            continue
        fixes.append({
            "id": food.get("id"),
            "name": food.get("name"),
            "source": food.get("source"),
            "old_cat": cat, "old_sub": sub,
            "new_cat": "protein", "new_sub": "plant_protein",
        })
        if apply:
            if "category_prev" not in food and cat:
                food["category_prev"] = cat
            food["category"] = "protein"
            food["subgroup"] = "plant_protein"
            food["macro_profile"] = "protein"

    print("=" * 80)
    print(f" plant_protein recategorization — {len(fixes)} entradas")
    print("=" * 80)
    for fx in fixes:
        print(f"  {fx['id']:24} {fx['name'][:42]:42}  "
              f"{fx['old_cat']}/{fx['old_sub']} → "
              f"{fx['new_cat']}/{fx['new_sub']}")
    print()
    print(f"  Mode: {'APPLY' if apply else 'DRY-RUN (use --apply to write)'}")
    print("=" * 80)

    if apply and fixes:
        with DB_PATH.open("w", encoding="utf-8") as f:
            json.dump(foods, f, ensure_ascii=False, indent=2)
        print(f"\n  database.json escrito con {len(fixes)} fixes.")

    return 0


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    sys.exit(main(apply))
