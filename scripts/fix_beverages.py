#!/usr/bin/env python3
"""
scripts/fix_beverages.py
Re-clasifica bebidas con leche que quedaron marcadas como `dairy` en
`database.json`.

Reportado por el cliente nutricionista (audit punto 6):
buscar "yogur griego" devolvía "516g de té con leche" en el top — un
té/café con leche NO es un lácteo equivalente a un yogur, es una bebida
caliente con leche añadida. La presencia de leche no convierte un
alimento en lácteo.

Reglas (idempotente, reversible):
  - Si name matches café/té/capuchino/latte/infusión con leche → mover
    a category='other', macro_profile='unknown', subgroup='other' o
    'beverage' (mantenemos 'other' por compat con resto del schema).
  - Persiste el category original en `category_prev` si no estaba ya.
  - No toca foods con `flags` críticos (condiment, prepared) salvo que
    sean claramente bebidas.
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "database.json"


def _norm(s: str) -> str:
    if not s:
        return ""
    nfkd = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


_BEVERAGE_PATTERNS = (
    r"\bcafe(?: con leche| latte| cappuccino| capuccino| capuchino| espresso| descafeinado| achicoria)\b",
    r"\bcappuccino\b",
    r"\bcapuccino\b",
    r"\bcapuchino\b",
    r"\blatte\b",
    r"\bte,? con leche\b",
    r"\bte,? infusion(?:,? con leche)?\b",
    r"\binfusion\b",
    r"\bcapsulas? (?:de )?cafe\b",
    r"\bdolce gusto\b",
)
_BEVERAGE_RE = re.compile("|".join(_BEVERAGE_PATTERNS))

# Solid dairy desserts that contain coffee/latte but are NOT beverages.
# Keep them in the dairy category.
_DESSERT_EXCLUDE_RE = re.compile(
    r"\b(panna cotta|tiramisu|mousse|natilla|flan|helado|tarta|pastel|"
    r"bizcocho|galleta|brownie|cheesecake|pudding|crema catalana)\b"
)


def is_beverage(food: dict) -> bool:
    """True if the food is a hot beverage (coffee/tea/infusion) — milk
    or no milk. Independent of current category to handle both
    fresh entries and already-miscategorized ones. Excludes solid dairy
    desserts that happen to contain coffee/latte in their name."""
    name = _norm(food.get("name") or "")
    if _DESSERT_EXCLUDE_RE.search(name):
        return False
    return bool(_BEVERAGE_RE.search(name))


def main() -> None:
    print(f"Leyendo {DB_PATH}...")
    with DB_PATH.open(encoding="utf-8") as f:
        foods = json.load(f)

    moved: list[dict] = []
    already: list[dict] = []

    for food in foods:
        if not is_beverage(food):
            continue
        current_cat = food.get("category")
        if current_cat == "other":
            already.append(food)
            continue
        if current_cat != "dairy":
            # Drinks already in other categories (rare): leave alone.
            continue

        if "category_prev" not in food:
            food["category_prev"] = current_cat
        food["category"] = "other"
        food["macro_profile"] = "unknown"
        food["subgroup"] = "other"
        moved.append({
            "id": food.get("id"),
            "name": food.get("name"),
            "kcal": food.get("calories"),
        })

    with DB_PATH.open("w", encoding="utf-8") as f:
        json.dump(foods, f, ensure_ascii=False, indent=2)

    print()
    print("=" * 72)
    print(" BEBIDAS CALIENTES MOVIDAS DE dairy → other")
    print("=" * 72)
    for m in moved:
        print(f"  {m['id']:<22}  {m['name']:<55}  {m['kcal']} kcal")
    print()
    print(f"  Movidas:                       {len(moved)}")
    print(f"  Ya estaban en 'other':         {len(already)}")
    print(f"  Total foods en DB:             {len(foods)}")
    print("=" * 72)
    print()
    print("database.json guardado.")


if __name__ == "__main__":
    main()
