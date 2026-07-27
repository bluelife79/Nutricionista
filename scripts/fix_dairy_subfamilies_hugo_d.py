#!/usr/bin/env python3
"""
scripts/fix_dairy_subfamilies_hugo_d.py

Recategoriza lácteos según el brief Hugo punto D del 16/05/2026:
"En leche, priorizar leche simple y bajar café con leche, Cacaolat,
Monster café, leche infantil, leche merengada, leche evaporada y
similares."

NUEVAS SUBFAMILIAS (extiende dairy_subfamily existente):
  - bebida_vegetal: leche/bebida de soja, almendra, coco, avena, arroz,
                    avellana, anacardo, horchata. NO comparten subfamilia
                    con leches animales.
  - leche_preparada: café con leche, cacao con leche, batidos saborizados,
                     leche infantil/de continuación, leche merengada,
                     leche evaporada, leche condensada (a veces ya en
                     postres_lacteos — respetar si está).

NO toca yogures, quesos, kéfires, ni leches puras (entera/semi/desnatada
sin sabor). Esos quedan en sus subfamilias actuales.

Uso:
  python3 scripts/fix_dairy_subfamilies_hugo_d.py             # dry-run
  python3 scripts/fix_dairy_subfamilies_hugo_d.py --apply     # escribe
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


# Bebidas vegetales (NO lácteo animal — Hugo: subfamilia separada)
BEBIDA_VEGETAL_RE = re.compile(
    r"^(bebida|leche)\s+(de\s+)?"
    r"(soja|soya|almendra|avena|coco|arroz|avellana|anacardo|"
    r"nuez|cacahuete|sesamo|sésamo|chufa|tigernuts)|"
    r"^horchata|"
    r"^drink\s+(de\s+)?"
    r"(soja|almendra|avena|coco|arroz|avellana|anacardo)",
    re.IGNORECASE,
)

# Leches preparadas / saborizadas (Hugo: bajar café con leche, cacaolat,
# monster café, leche infantil, leche merengada, leche evaporada)
LECHE_PREPARADA_RE = re.compile(
    r"\b("
    r"cafe?\s*con\s*leche|"
    r"caf[eé]\s+latte|"
    r"caf[eé]\s+macchiato|"
    r"caf[eé]\s+cortado|"
    r"caf[eé]\s+capuccino|"
    r"caf[eé]\s+capuchino|"
    r"cacaolat|"
    r"colacao|"
    r"nesquik|"
    r"chococao|"
    r"leche\s+chocolate|"
    r"leche\s+con\s+cacao|"
    r"leche\s+con\s+chocolate|"
    r"leche\s+infantil|"
    r"leche\s+de\s+continuacion|"
    r"leche\s+de\s+continuación|"
    r"leche\s+merengada|"
    r"leche\s+evaporada|"
    r"leche\s+condensada|"
    r"batido\s+sabor|"
    r"batido\s+de\s+(chocolate|fresa|vainilla|cacao|platano|plátano)|"
    r"monster\s+caf[eé]|"
    r"frappuccino|"
    r"frappe|"
    r"leche\s+merengue"
    r")\b",
    re.IGNORECASE,
)


def classify(food: dict) -> str | None:
    """Returns new dairy_subfamily or None if no change."""
    name = food.get("name") or ""
    nameN = _norm(name)

    # Only act on category dairy or dairy-adjacent products
    cat = food.get("category")
    if cat not in ("dairy", "carbs", "other"):
        # Bebidas vegetales pueden estar mal en cat=carbs (Bebida de arroz)
        # o cat=other. Permitir reasignar.
        return None

    # Bebida vegetal — máxima prioridad
    if BEBIDA_VEGETAL_RE.match(name):
        return "bebida_vegetal"

    # Leche preparada (saborizada / café / infantil)
    if cat == "dairy" and LECHE_PREPARADA_RE.search(nameN):
        return "leche_preparada"

    return None


def main(apply: bool) -> int:
    with DB_PATH.open(encoding="utf-8") as f:
        foods = json.load(f)

    fixes = []
    for food in foods:
        new_sf = classify(food)
        if new_sf is None:
            continue
        old_sf = food.get("dairy_subfamily")
        old_cat = food.get("category")
        old_sub = food.get("subgroup")
        if old_sf == new_sf:
            continue
        fixes.append({
            "id": food.get("id"),
            "name": food.get("name"),
            "source": food.get("source"),
            "old_cat": old_cat, "old_sub": old_sub, "old_sf": old_sf,
            "new_sf": new_sf,
        })
        if apply:
            food["dairy_subfamily"] = new_sf
            # Si era bebida vegetal con category != dairy, mover a dairy/other_dairy
            # para que el sistema lo trate como lácteo subfamiliar.
            if new_sf == "bebida_vegetal" and old_cat != "dairy":
                if "category_prev" not in food:
                    food["category_prev"] = old_cat
                food["category"] = "dairy"
                food["subgroup"] = "other_dairy"

    print()
    print("=" * 80)
    print(f"  Lácteos Hugo D — {len(fixes)} fixes")
    print("=" * 80)
    by_kind = Counter(f["new_sf"] for f in fixes)
    for k, v in by_kind.most_common():
        print(f"  {k:<22} {v:>4}")
    print()
    print("--- Sample (primeros 20) ---")
    for fx in fixes[:20]:
        was = f"{fx['old_cat']}/{fx['old_sub']}/{fx['old_sf']}"
        print(f"  {fx['id']:24} {fx['name'][:50]:50}  {was:35} → {fx['new_sf']}")
    if len(fixes) > 20:
        print(f"  … ({len(fixes) - 20} más)")
    print()
    print(f"  Mode: {'APPLY' if apply else 'DRY-RUN (--apply para escribir)'}")
    print("=" * 80)

    if apply and fixes:
        with DB_PATH.open("w", encoding="utf-8") as f:
            json.dump(foods, f, ensure_ascii=False, indent=2)
        print(f"\n  database.json escrito con {len(fixes)} fixes.")

    return 0


if __name__ == "__main__":
    sys.exit(main("--apply" in sys.argv))
