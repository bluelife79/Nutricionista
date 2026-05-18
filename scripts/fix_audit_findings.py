#!/usr/bin/env python3
"""
scripts/fix_audit_findings.py

Aplica fixes deterministas a los bugs detectados por audit_full_db.py.
Cada fix es atómico, idempotente, y reversible.

FIXES APLICADOS:
  F1. Foies sin exotic=true → set exotic=true (3 entradas)
  F2. Pescados enlatados en aceite con category=fat → mover a category=protein
      con subgroup=fish_fatty + oil_added=true (latas que vio Hugo en aceite)
  F3. macro_profile faltante → inferir del macro dominante por gramos
  F4. source faltante → asignar 'legacy' (data antigua sin attribution)
  F5. Cremas de almendra/cacahuete/avellana en carbs → mover a fat/nuts_seeds
      si son sin azúcar añadido (>40g fat/100g)

Uso:
  python3 scripts/fix_audit_findings.py             # dry-run
  python3 scripts/fix_audit_findings.py --apply     # escribe
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "database.json"


def _norm(s: str) -> str:
    if not s:
        return ""
    nfkd = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def f1_foie_exotic(food: dict) -> tuple[bool, str | None]:
    """Mark foies as exotic=true. Hugo brief: 'foie' al fondo."""
    name = _norm(food.get("name") or "")
    if re.search(r"\bfoie\b", name) and food.get("exotic") is not True:
        return True, "exotic=False → exotic=True"
    return False, None


def f2_fish_in_oil(food: dict) -> tuple[bool, str | None]:
    """Pescados enlatados en aceite con category=fat → category=protein.
    Bug detectado por Hugo: sardina/bonito/caballa en aceite no son grasa,
    son pescado con aceite añadido. Reasignar a protein/fish_fatty +
    oil_added=true."""
    if food.get("category") != "fat":
        return False, None
    if food.get("subgroup") != "fish":
        return False, None
    name = _norm(food.get("name") or "")
    # Confirmar que es pescado en aceite
    is_fish_in_oil = bool(re.search(
        r"\b(sardina|bonito|caballa|at[uú]n|melva|anchoa|boquer[oó]n|"
        r"jurel|salm[oó]n|salmonete|chicharro|arenque)\b", name
    )) and bool(re.search(r"en aceite|en oliva", name))
    if not is_fish_in_oil:
        return False, None
    return True, "fat/fish → protein/fish_fatty + oil_added=true"


def f3_macro_profile_infer(food: dict) -> tuple[bool, str | None]:
    """Infiere macro_profile faltante por macro dominante en gramos.
    Si proteína >= 5g y proteína > carbs y > grasa → protein.
    Si fat >= 5g y fat > carbs y > protein → fat.
    Si carbs >= 5g y carbs > protein y > fat → carbs.
    Else: calories (sin anchor)."""
    if food.get("macro_profile"):
        return False, None
    p = food.get("protein") or 0
    c = food.get("carbs") or 0
    f_ = food.get("fat") or 0
    if p >= 5 and p >= c and p >= f_:
        new_mp = "protein"
    elif f_ >= 5 and f_ >= c and f_ >= p:
        new_mp = "fat"
    elif c >= 5 and c >= p and c >= f_:
        new_mp = "carbs"
    else:
        new_mp = "calories"
    return True, f"macro_profile=None → {new_mp}"


def f4_source_legacy(food: dict) -> tuple[bool, str | None]:
    """source faltante → 'legacy'."""
    if food.get("source"):
        return False, None
    return True, "source=None → 'legacy'"


def f5_nut_cream_to_fat(food: dict) -> tuple[bool, str | None]:
    """Cremas de frutos secos sin azúcar añadido (>40g fat) deberían ser
    fat/nuts_seeds, no carbs. Si tiene <40g fat probablemente sí es carb
    (versión con mucho azúcar)."""
    name = _norm(food.get("name") or "")
    if food.get("category") != "carbs":
        return False, None
    if food.get("subgroup") != "nuts_seeds":
        return False, None
    fat = food.get("fat") or 0
    if not re.search(r"\bcrema\s+de\s+(almendra|cacahuete|avellana|maní|anacardo)\b", name):
        return False, None
    if fat < 40:
        return False, None  # versión azucarada, dejar como carb
    return True, f"carbs/nuts_seeds (F={fat}) → fat/nuts_seeds"


FIXES = [
    ("F1", "Foie sin exotic",      f1_foie_exotic),
    ("F2", "Pescado en aceite mal cat", f2_fish_in_oil),
    ("F3", "macro_profile inferido",     f3_macro_profile_infer),
    ("F4", "source faltante",            f4_source_legacy),
    ("F5", "Crema frutos secos → fat",  f5_nut_cream_to_fat),
]


def main(apply: bool) -> int:
    with DB_PATH.open(encoding="utf-8") as f:
        foods = json.load(f)

    fix_counts = Counter()
    all_changes = []

    for food in foods:
        for key, label, fn in FIXES:
            should_fix, msg = fn(food)
            if not should_fix:
                continue
            fix_counts[key] += 1
            all_changes.append({
                "fix": key, "label": label,
                "id": food.get("id"), "name": food.get("name"),
                "change": msg,
            })
            if apply:
                # Apply the change
                if key == "F1":
                    food["exotic"] = True
                elif key == "F2":
                    if "category_prev" not in food:
                        food["category_prev"] = food.get("category")
                    food["category"] = "protein"
                    food["subgroup"] = "fish_fatty"
                    food["oil_added"] = True
                    food["macro_profile"] = "protein"
                elif key == "F3":
                    # Re-infer
                    p = food.get("protein") or 0
                    c = food.get("carbs") or 0
                    f_ = food.get("fat") or 0
                    if p >= 5 and p >= c and p >= f_:    food["macro_profile"] = "protein"
                    elif f_ >= 5 and f_ >= c and f_ >= p: food["macro_profile"] = "fat"
                    elif c >= 5 and c >= p and c >= f_:  food["macro_profile"] = "carbs"
                    else:                                food["macro_profile"] = "calories"
                elif key == "F4":
                    food["source"] = "legacy"
                elif key == "F5":
                    if "category_prev" not in food:
                        food["category_prev"] = food.get("category")
                    food["category"] = "fat"

    print()
    print("=" * 80)
    print("  AUDIT FIX SUMMARY")
    print("=" * 80)
    for key, label, _ in FIXES:
        print(f"  {key:<5} {label:<40} {fix_counts[key]:>5}")
    print(f"  {'TOTAL':<46} {sum(fix_counts.values()):>5}")
    print("=" * 80)
    print()

    # Sample por fix
    for key, label, _ in FIXES:
        items = [c for c in all_changes if c["fix"] == key]
        if items:
            print(f"--- {key} {label} ---")
            for it in items[:8]:
                print(f"  {it['id']:24} {it['name'][:45]:45}  {it['change']}")
            if len(items) > 8:
                print(f"  … ({len(items) - 8} más)")
            print()

    print(f"  Mode: {'APPLY' if apply else 'DRY-RUN (use --apply to write)'}")
    print()

    if apply and all_changes:
        with DB_PATH.open("w", encoding="utf-8") as f:
            json.dump(foods, f, ensure_ascii=False, indent=2)
        print(f"  database.json escrito con {len(all_changes)} fixes.")

    return 0


if __name__ == "__main__":
    sys.exit(main("--apply" in sys.argv))
