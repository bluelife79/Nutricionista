#!/usr/bin/env python3
"""
fix_other_protein.py — Fix 90 foods stuck in subgroup=other_protein.

Most are cheeses miscategorized as category=protein. Also catches mislabeled
fish, nuts, jamón, and a handful of plant_protein foods.

Idempotent. Creates database.json.bak.<unix_ts> before writing.
"""

import json
import re
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "database.json"

AGED_CHEESE_KW = [
    "grana padano", "parmigiano", "parmesan", "maasdam", "gouda",
    "emmental", "emmenta", "cheddar", "provolone", "comté", "comte",
    "camembert", "gruy", "pecorino", "edam", "raclette", "mimolette",
    "abondance", "manchego", "havarti", "formatge maasdam", "formatge edam",
    "tilsit", "appenzeller", "asiago", "iddiazabal", "idiazabal",
]
FRESH_CHEESE_KW = [
    "mozzarella", "mozzarela",
    "fromage light", "käse light", "kase light", "havarti light",
    "gouda light", "sense lactosa", "queso fresco", "ricotta", "burgos",
    "feta", "cottage", "quark", "requesón", "requeson",
]
PROCESSED_MEAT_KW = [
    "jamon", "jamón", "jambon", "paleta cocida", "chouric", "chorizo",
    "salchich", "fuet", "salami", "sobrasada", "longaniza", "mortadela",
    "butifarra", "morcilla",
]
FISH_FATTY_KW = [
    "sardin", "sardinetes", "sardinha", "atún", "atun", "tonyina",
    "tonny", "salmon", "salmón", "caballa", "boquerón", "boqueron",
    "boquerones", "anchoa", "anchova", "jurel", "palometa", "bonito",
    "arenque",
]
FISH_WHITE_KW = [
    "merluza", "lubina", "dorada", "bacalao", "lenguado", "gallo", "rape",
    "mero", "panga", "tilapia",
]
SEAFOOD_KW = [
    "chipirón", "chipiron", "potón", "poton", "calamar", "pulpo", "sepia",
    "gamba", "langostino", "mejillón", "mejillon", "almeja",
]
NUTS_SEEDS_KW = [
    "nueces", "nuez", "almendra", "avellana", "anacardo", "pistacho",
    "pipa", "pipas", "semilla", "semillas", "calabaza natural",
]
PLANT_PROTEIN_KW = [
    "vegetarische", "vegano", "vegana", "tofu", "seitán", "seitan",
    "tempeh", "heura", "edamame", "soja texturizada", "proteina vegetal",
    "proteína vegetal", "quorn", "mycoprotein",
]
PROTEIC_DESSERT_KW = [
    "alto contenido en proteinas", "alto en proteínas", "alto en proteinas",
    "high protein", "proteica", "proteico",
]


def norm(s):
    s = (s or "").lower()
    s = s.replace("ñ", "n")
    return re.sub(r"[^a-z0-9 ]+", " ", s)


def has_any(name_norm, kws):
    return any(kw.replace("ñ", "n") in name_norm for kw in (norm(k) for k in kws))


def classify(name):
    n = norm(name)
    if has_any(n, FRESH_CHEESE_KW):
        return "dairy", "fresh_cheese"
    if has_any(n, AGED_CHEESE_KW):
        return "dairy", "aged_cheese"
    if has_any(n, PROCESSED_MEAT_KW):
        return "protein", "processed_meat"
    if has_any(n, PLANT_PROTEIN_KW):
        return "protein", "plant_protein"
    if has_any(n, FISH_FATTY_KW):
        return "protein", "fish_fatty"
    if has_any(n, FISH_WHITE_KW):
        return "protein", "fish_white"
    if has_any(n, SEAFOOD_KW):
        return "protein", "fish_white"
    if has_any(n, NUTS_SEEDS_KW):
        return "fat", "nuts_seeds"
    if has_any(n, PROTEIC_DESSERT_KW):
        return "postres_proteicos", "high_protein_dairy"
    return None


def main():
    with open(DB_PATH) as fh:
        db = json.load(fh)
    foods = db if isinstance(db, list) else db.get("foods", db)

    targets = [f for f in foods if f.get("subgroup") == "other_protein"]
    print(f"Foods with subgroup=other_protein: {len(targets)}")

    changes = []
    unresolved = []
    for f in targets:
        result = classify(f.get("name", ""))
        if result is None:
            unresolved.append(f)
            continue
        new_cat, new_sub = result
        old_cat = f.get("category")
        old_sub = f.get("subgroup")
        if old_cat != new_cat or old_sub != new_sub:
            f["category"] = new_cat
            f["subgroup"] = new_sub
            changes.append((f.get("name", "")[:50], f"{old_cat}/{old_sub}", f"{new_cat}/{new_sub}"))

    print(f"\nReclassified: {len(changes)}")
    print(f"Unresolved (left as-is): {len(unresolved)}")

    if not changes:
        print("\nNo-op (idempotent). Exiting without write.")
        return

    backup = DB_PATH.with_suffix(f".json.bak.{int(time.time())}")
    shutil.copy(DB_PATH, backup)
    print(f"\nBackup: {backup.name}")

    with open(DB_PATH, "w", encoding="utf-8") as fh:
        json.dump(db, fh, ensure_ascii=False, indent=2)
    print(f"Wrote {DB_PATH.name}")

    print("\nDiff sample (first 15):")
    for name, before, after in changes[:15]:
        print(f"  {name:50s}  {before:25s} -> {after}")

    print(f"\nUnresolved sample (first 10):")
    for f in unresolved[:10]:
        print(f"  {f.get('name', '')[:60]}")


if __name__ == "__main__":
    main()
