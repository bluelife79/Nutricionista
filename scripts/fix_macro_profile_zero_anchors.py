#!/usr/bin/env python3
"""
scripts/fix_macro_profile_zero_anchors.py

Repara entradas donde `macro_profile` declara un macro que está
literalmente ausente (<2 g/100g) en el alimento. Esos casos rompen
calculateEquivalence — la división por el anchor se vuelve absurda
o NaN, y el food devuelve 0 alternativas.

Caso disparador: "Atún" Carrefour (off_8c18e1c0a9) tenía
macro_profile="carbs" con carbs=0 y protein=26 → T04 del test suite
devolvía 0 alternativas.

Regla determinista:
  - Si macro_profile in {protein, carbs, fat} y ese macro < 2g/100g:
    → reasignar al macro REALMENTE dominante por gramos (no kcal),
      con preferencia categórica para alimentos donde culinariamente
      manda la proteína (category=protein → protein).

NO toca los 833 mismatches culinariamente debatibles (queso/jamón/
huevo declarados protein pero kcal-dominados por grasa). Eso es
decisión nutricional que se mantiene como está.

NO toca category, subgroup, ni macros — solo macro_profile.

Uso:
  python3 scripts/fix_macro_profile_zero_anchors.py            # dry-run
  python3 scripts/fix_macro_profile_zero_anchors.py --apply    # escribe
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "database.json"

ZERO_THRESHOLD = 2.0  # g/100g — por debajo de esto el anchor es inviable


def pick_new_profile(food: dict) -> str | None:
    """Return new macro_profile or None if no candidate is viable.

    Preferencia:
      1) category=protein → si protein>=2 reasignar a 'protein'
      2) category=fat → si fat>=2 reasignar a 'fat'
      3) category=carbs → si carbs>=2 reasignar a 'carbs'
      4) sino: el macro con mayor gramos (>=2g)
      5) último recurso: 'calories' (sin anchor, usa kcal)
    """
    p = food.get("protein") or 0
    c = food.get("carbs") or 0
    f = food.get("fat") or 0
    cat = food.get("category")

    # Category-driven preference first
    if cat == "protein" and p >= ZERO_THRESHOLD:
        return "protein"
    if cat == "fat" and f >= ZERO_THRESHOLD:
        return "fat"
    if cat == "carbs" and c >= ZERO_THRESHOLD:
        return "carbs"

    # Dominant by grams (>=2g threshold)
    candidates = [("protein", p), ("carbs", c), ("fat", f)]
    candidates = [(k, v) for k, v in candidates if v >= ZERO_THRESHOLD]
    if candidates:
        return max(candidates, key=lambda x: x[1])[0]

    # Last resort: calories anchor (no macro dominant >= 2g)
    return "calories"


def main(apply: bool) -> int:
    with DB_PATH.open(encoding="utf-8") as f:
        foods = json.load(f)

    fixes = []
    for food in foods:
        mp = food.get("macro_profile")
        if mp not in ("protein", "carbs", "fat"):
            continue
        val = food.get(mp) or 0
        if val >= ZERO_THRESHOLD:
            continue

        new_mp = pick_new_profile(food)
        if new_mp == mp:
            continue  # nothing better available

        fixes.append({
            "id": food.get("id"),
            "name": food.get("name"),
            "source": food.get("source"),
            "old_mp": mp,
            "new_mp": new_mp,
            "protein": food.get("protein"),
            "carbs": food.get("carbs"),
            "fat": food.get("fat"),
        })

        if apply:
            food["macro_profile"] = new_mp

    print("=" * 80)
    print(f" macro_profile zero-anchor fix — {len(fixes)} entradas")
    print("=" * 80)
    for fx in fixes:
        print(f"  {fx['id']:24} {fx['name'][:42]:42}  "
              f"{fx['old_mp']:7} → {fx['new_mp']:8}  "
              f"P={fx['protein']} C={fx['carbs']} F={fx['fat']}")
    print()
    print(f"  Total: {len(fixes)}")
    print(f"  Mode:  {'APPLY' if apply else 'DRY-RUN (use --apply to write)'}")
    print("=" * 80)

    if apply:
        with DB_PATH.open("w", encoding="utf-8") as f:
            json.dump(foods, f, ensure_ascii=False, indent=2)
        print(f"\n  database.json escrito con {len(fixes)} fixes aplicados.")

    return 0


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    sys.exit(main(apply))
