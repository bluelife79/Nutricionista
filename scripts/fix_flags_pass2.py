#!/usr/bin/env python3
"""Fix determinístico de flags raw_ingredient + meal_slot post-bulk-label.

Detecta patrones sistemáticos sin LLM:
1. Granos/cereales crudos con kcal alto pero raw_ingredient=False → fix a True.
2. Legumbres secas con kcal alto pero raw_ingredient=False → fix a True.
3. Pan/bollería con meal:any → mover a desayuno (heurística por nombre).

Genera backup + reporte CSV. Idempotente — re-correr no aplica más cambios.

Uso:
    python scripts/fix_flags_pass2.py --dry-run    # solo reporta
    python scripts/fix_flags_pass2.py --apply       # aplica + backup
"""
from __future__ import annotations
import argparse
import csv
import json
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB = ROOT / "database.json"
REPORT = ROOT / "scripts" / "fix_flags_pass2_report.csv"

# Heurísticas
RAW_KCAL_GRAIN_MIN   = 300   # granos crudos: >=300 kcal/100g
RAW_KCAL_LEGUME_MIN  = 280   # legumbres secas: >=280 kcal/100g
COOKED_NAME_TOKENS   = {
    "cocido","cocida","cocidos","cocidas",
    "hervido","hervida","hervidos","hervidas",
    "asado","asada","asados","asadas",
    "frito","frita","fritos","fritas",
    "plancha","vapor",
    "horneado","horneada","horneados","horneadas",
    "tostado","tostada","tostados","tostadas",
    "guisado","guisada","guisados","guisadas",
    "salteado","salteada","salteados","salteadas",
    "rehogado","rehogada","estofado","estofada","braseado","braseada",
}
PAN_DESAYUNO_HINTS   = {
    "tostada","tostadas","biscote","biscotes","cracker","crackers",
    "molde","brioche","bollo","bollos","baguette","panecillo","panecillos",
    "rosca","rosquillas","cruasan","croissant","ensaimada",
}
PAN_COMIDA_HINTS     = {
    "rallado","rallar",  # pan rallado para empanar
}

def has_cooked_marker(name: str) -> bool:
    n = name.lower()
    return any(t in n.split() or t in n for t in COOKED_NAME_TOKENS)

def fix_grains(food: dict) -> tuple[str, dict] | None:
    if food.get("subgroup") != "grains":
        return None
    kcal = food.get("calories") or 0
    if kcal < RAW_KCAL_GRAIN_MIN:
        return None
    if food.get("ready_to_eat") is True:
        return None  # cereal de caja, pan tostado, etc.
    if food.get("raw_ingredient") is True:
        return None  # ya correcto
    if has_cooked_marker(food.get("name") or ""):
        return None  # nombre dice cocido — no tocar
    # Excluir cosas obvias que no son granos crudos pese a kcal alto
    n = (food.get("name") or "").lower()
    if any(h in n for h in ("snack","crujiente","fritos","papas","chip","palomitas","cereales desayuno","cereales de desayuno")):
        return None
    return ("grain_raw", {"raw_ingredient": True})

def fix_legumes(food: dict) -> tuple[str, dict] | None:
    if food.get("subgroup") not in ("legumes", "legumbres"):
        return None
    kcal = food.get("calories") or 0
    if kcal < RAW_KCAL_LEGUME_MIN:
        return None
    if food.get("ready_to_eat") is True:
        return None  # garbanzos tostados snack, hummus → ready
    if food.get("raw_ingredient") is True:
        return None
    if has_cooked_marker(food.get("name") or ""):
        return None
    return ("legume_raw", {"raw_ingredient": True})

def fix_pan_mealslot(food: dict) -> tuple[str, dict] | None:
    n = (food.get("name") or "").lower()
    tokens = set(n.replace(",", " ").split())
    is_pan = "pan" in tokens or n.startswith("pan ") or "tostada" in tokens or "biscote" in tokens
    if not is_pan:
        return None
    if food.get("meal_slot") != "any":
        return None  # ya específico — respetamos
    # Pan rallado, pan para empanar, pan especial → mantener any
    if any(h in n for h in PAN_COMIDA_HINTS):
        return None
    # Heurística: pan blanco/molde/tostadas/bollería → desayuno
    if (any(h in tokens for h in PAN_DESAYUNO_HINTS) or
        n.startswith("pan ") or
        "pan blanco" in n or "pan molde" in n or "pan integral" in n or
        "pan de" in n):
        return ("pan_desayuno", {"meal_slot": "desayuno"})
    return None

FIXERS = [fix_grains, fix_legumes, fix_pan_mealslot]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Aplicar cambios + backup. Sin esto, dry-run.")
    args = ap.parse_args()

    db = json.loads(DB.read_text(encoding="utf-8"))
    foods = db if isinstance(db, list) else db.get("foods", [])
    print(f"Total foods: {len(foods)}")

    changes = []  # (food_id, name, fix_type, before_dict, after_dict)
    for f in foods:
        for fixer in FIXERS:
            r = fixer(f)
            if r is None:
                continue
            fix_type, patch = r
            before = {k: f.get(k) for k in patch}
            after = patch
            changes.append((f.get("id"), f.get("name"), fix_type, before, after))
            # En dry-run, NO mutamos f. En apply sí.
            if args.apply:
                f.update(patch)

    # Reporte
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    with REPORT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id","name","fix_type","before","after"])
        for c in changes:
            w.writerow([c[0], c[1], c[2], json.dumps(c[3], ensure_ascii=False), json.dumps(c[4], ensure_ascii=False)])

    by_type = {}
    for c in changes:
        by_type[c[2]] = by_type.get(c[2], 0) + 1
    print(f"\nCambios propuestos: {len(changes)}")
    for k, v in sorted(by_type.items()):
        print(f"  {k:<20} {v}")
    print(f"\nReporte: {REPORT}")

    if args.apply:
        ts = int(time.time())
        bak = ROOT / f"database.json.bak.{ts}"
        shutil.copy(DB, bak)
        DB.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n✓ Aplicado. Backup: {bak.name}")
    else:
        print("\n(dry-run — nada aplicado. Usar --apply para escribir.)")

if __name__ == "__main__":
    main()
