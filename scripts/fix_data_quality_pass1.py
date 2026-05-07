#!/usr/bin/env python3
"""
fix_data_quality_pass1.py

Doble propósito en una sola pasada:

1) CORRIGE los 4 alimentos detectados con macros incorrectos:
   - bedca_0179 "Arroz, hervido"      386 cal -> 130 cal (bug etiqueta crudo->hervido)
   - bedca_0135 "Garbanzo, hervida"   354 cal -> 135 cal (bug etiqueta seco->hervida)
   - bedca_0444 "Pavo, fiambre"       147 cal -> 105 cal (BEDCA generic alta grasa, comercial es magro)
   - bedca_0108 "Jamon serrano"       319 cal -> 245 cal (BEDCA generic con grasa pieza, loncheado es ~240)

2) AGREGA 15 entradas de chocolate negro (3 BEDCA-genéricas + 12 marcas comerciales).
   Categoría por macro real (regla highest-gram-wins de la BD):
     70% cacao -> category=carbs (carbs > fat)
     85%+ cacao -> category=fat (fat > carbs)
   Subgroup: sweets_bakery
   Flag: sweet (excluye del algoritmo de intercambios — es snack ocasional)

Idempotente. Backup database.json.bak.<unix_ts> antes de escribir.
"""

import json
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "database.json"

# ---- 1) Correcciones de macros ----
MACRO_FIXES = {
    "bedca_0179": {  # Arroz, hervido
        "calories": 130.0,
        "protein": 2.7,
        "carbs": 28.0,
        "fat": 0.3,
        "_reason": "Valores BEDCA correspondían a crudo, no hervido. USDA/AECOSAN ref: arroz blanco cocido ~130 kcal.",
    },
    "bedca_0135": {  # Garbanzo, hervida
        "calories": 135.0,
        "protein": 8.9,
        "carbs": 18.7,
        "fat": 2.5,
        "_reason": "Valores BEDCA correspondían a seco. Match con bedca_xxxx 'Garbanzo, hervido' que ya tiene valores correctos.",
    },
    "bedca_0444": {  # Pavo, fiambre
        "calories": 105.0,
        "protein": 19.0,
        "carbs": 1.0,
        "fat": 1.5,
        "_reason": "BEDCA generic era alta grasa (147/9.4f). Realidad comercial Mercadona/Hacendado/Carrefour ~105 cal, 19p, 1.5f.",
    },
    "bedca_0108": {  # Jamon serrano
        "calories": 245.0,
        "protein": 28.0,
        "carbs": 0.5,
        "fat": 14.5,
        "_reason": "BEDCA generic incluía grasa de pieza completa (319/22.6f). Loncheado comercial reserva ~245 cal, 28p, 14.5f.",
    },
}


def make_chocolate_entry(
    next_id_num: int,
    source: str,
    name: str,
    brand: str | None,
    cal: float,
    prot: float,
    carb: float,
    fat: float,
    cacao_pct: int,
) -> dict:
    """Build a chocolate negro entry with correct category/macro_profile by macros."""
    # Highest-gram-wins rule (consistent with BD convention: turrón, regaliz, etc.)
    if fat > carb:
        category = "fat"
        macro_profile = "fat"
    else:
        category = "carbs"
        macro_profile = "carbs"

    return {
        "source": source,
        "name": name,
        "protein": prot,
        "carbs": carb,
        "fat": fat,
        "calories": cal,
        "category": category,
        "brand": brand,
        "id": f"manual_choco_{next_id_num:04d}",
        "code": None,
        "quantity": None,
        "subgroup": "sweets_bakery",
        "macro_profile": macro_profile,
        "flags": ["sweet"],
        # Bulk-label fields (consistent with the rest of the DB)
        "ready_to_eat": True,
        "raw_ingredient": False,
        "meal_slot": "snack",
        "frequency": "ocasional",
        "exotic": False,
        "label_confidence": 95,
        "label_reason": f"Chocolate negro {cacao_pct}% cacao, snack ocasional dominante en grasa/carbs según %.",
    }


# ---- 2) Entradas chocolate negro ----
# Valores: BEDCA tabla oficial + etiquetas comerciales típicas españolas (per 100g)
CHOCOLATE_ENTRIES_RAW = [
    # (source, name, brand, cal, protein, carbs, fat, cacao%)
    # BEDCA-style genéricas
    ("BEDCA", "Chocolate negro 70% cacao", "Marca Blanca", 540.0, 7.2, 47.0, 35.0, 70),
    ("BEDCA", "Chocolate negro 85% cacao", "Marca Blanca", 600.0, 9.0, 22.0, 50.0, 85),
    ("BEDCA", "Chocolate negro 99% cacao", "Marca Blanca", 605.0, 12.0, 14.0, 53.0, 99),
    # Marcas comerciales españolas
    ("Valor", "Valor Chocolate Negro 70% Cacao", "Valor", 545.0, 7.5, 38.0, 38.0, 70),
    ("Valor", "Valor Chocolate Negro 85% Cacao", "Valor", 590.0, 9.5, 21.0, 49.0, 85),
    ("Lindt", "Lindt Excellence 70% Cacao", "Lindt", 555.0, 9.0, 34.0, 41.0, 70),
    ("Lindt", "Lindt Excellence 85% Cacao", "Lindt", 590.0, 11.0, 19.0, 46.0, 85),
    ("Lindt", "Lindt Excellence 90% Cacao", "Lindt", 600.0, 12.0, 14.0, 51.0, 90),
    ("Hacendado", "Hacendado Chocolate Negro 70% Cacao", "Hacendado", 540.0, 7.0, 41.0, 36.0, 70),
    ("Hacendado", "Hacendado Chocolate Negro 85% Cacao", "Hacendado", 590.0, 10.0, 22.0, 48.0, 85),
    ("Carrefour", "Carrefour Chocolate Negro 72% Cacao", "Carrefour", 550.0, 8.0, 38.0, 38.0, 72),
    ("Nestle", "Nestlé Postres Chocolate Negro", "Nestlé", 530.0, 6.5, 51.0, 31.0, 52),
    ("Torras", "Torras Chocolate Negro 70% sin azúcar añadido", "Torras", 510.0, 8.0, 39.0, 35.0, 70),
    ("Hacendado", "Hacendado Chocolate Puro Cacao", "Hacendado", 540.0, 9.0, 30.0, 39.0, 75),
    ("Lidl", "Fin Carré Chocolate Negro 85% Cacao", "Fin Carré", 590.0, 11.0, 21.0, 47.0, 85),
]


def main():
    # Load
    with open(DB_PATH, encoding="utf-8") as fh:
        db = json.load(fh)
    foods = db if isinstance(db, list) else db.get("foods", db)

    print(f"Loaded {len(foods)} foods from {DB_PATH.name}")

    # ---- Apply macro fixes ----
    fixes_applied = 0
    fixes_skipped = 0
    for f in foods:
        fid = f.get("id")
        if fid in MACRO_FIXES:
            fix = MACRO_FIXES[fid]
            current_cal = f.get("calories")
            target_cal = fix["calories"]
            if abs((current_cal or 0) - target_cal) < 1.0:
                fixes_skipped += 1
                continue  # already fixed
            print(f"  FIX {fid:20s} '{f.get('name','')[:35]:35s}'  cal {current_cal:>6.1f} -> {target_cal:>6.1f}")
            f["calories"] = fix["calories"]
            f["protein"] = fix["protein"]
            f["carbs"] = fix["carbs"]
            f["fat"] = fix["fat"]
            fixes_applied += 1

    print(f"\nMacro fixes: applied={fixes_applied} skipped(already-fixed)={fixes_skipped}")

    # ---- Add chocolate entries (idempotent: skip if same name+brand exists) ----
    existing_keys = {(f.get("name", "").lower(), (f.get("brand") or "").lower()) for f in foods}
    chocolate_added = 0
    chocolate_skipped = 0
    next_id_num = 1
    for source, name, brand, cal, prot, carb, fat, cacao_pct in CHOCOLATE_ENTRIES_RAW:
        key = (name.lower(), (brand or "").lower())
        if key in existing_keys:
            chocolate_skipped += 1
            continue
        entry = make_chocolate_entry(next_id_num, source, name, brand, cal, prot, carb, fat, cacao_pct)
        foods.append(entry)
        next_id_num += 1
        chocolate_added += 1
        print(f"  ADD chocolate: {entry['name'][:50]:50s} category={entry['category']:5s} cal={cal} fat={fat}")

    print(f"\nChocolate entries: added={chocolate_added} skipped(already-exists)={chocolate_skipped}")

    if fixes_applied == 0 and chocolate_added == 0:
        print("\nNo-op (idempotent). Exiting without write.")
        return

    # ---- Backup + atomic write ----
    backup = DB_PATH.with_suffix(f".json.bak.{int(time.time())}")
    shutil.copy(DB_PATH, backup)
    print(f"\nBackup: {backup.name}")

    tmp = DB_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(db, fh, ensure_ascii=False, indent=2)
    tmp.replace(DB_PATH)
    print(f"Wrote {DB_PATH.name} ({len(foods)} foods total)")


if __name__ == "__main__":
    main()
