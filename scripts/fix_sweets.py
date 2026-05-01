#!/usr/bin/env python3
"""
scripts/fix_sweets.py
Marca golosinas y dulces en database.json con flags: ["sweet"].

Las golosinas (Mousy, Krokodil', Osi Fruit, caramelos, gominolas, etc.) estaban
clasificadas como category='carbs' sin ningún flag, lo que hacía que el algoritmo
de intercambios las presentara como alternativa al arroz o la pasta — clínicamente
absurdo.

Este script las identifica por restricciones de macros + subgroup y les agrega
el flag "sweet". El algoritmo luego las excluye del pool de candidatos.

Reglas de detección — un alimento es "sweet" si cumple TODOS:
  1. category == "carbs"
  2. subgroup in {"other_carbs", "other"}  (no está en granos/tubérculos/frutas/legumbres)
  3. calories > 250 por 100g
  4. carbs > 60 por 100g
  5. protein < 8 por 100g
  6. fat < 5 por 100g  (descarta chocolate, que tiene más grasa)
  7. NO tiene ya flags "condiment" ni "prepared"
  8. NO tiene keywords de cereal de desayuno en el nombre normalizado
  9. NO tiene keywords de fruta seca válida en el nombre normalizado

Acción: agregar "sweet" a la lista de flags existente (sin borrar otros flags).

Salidas:
  database.json   — modificado in-place (git controla versiones)
"""

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "database.json"

# ---------------------------------------------------------------------------
# Normalización de texto
# ---------------------------------------------------------------------------

def norm(s: str) -> str:
    """Minúsculas, sin acentos, sin caracteres especiales."""
    s = s.lower().strip()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# ---------------------------------------------------------------------------
# Keywords de exclusión
# ---------------------------------------------------------------------------

# Cereales de desayuno: energía alta pero son carbohidratos legítimos.
BREAKFAST_CEREAL_KEYWORDS = {
    "corn flakes", "muesli", "granola", "copos", "cereales", "blat de moro",
}

# Frutas secas: calorías altas y muchos carbos, pero son intercambios válidos.
DRIED_FRUIT_KEYWORDS = {
    "datil", "arandano", "pasas", "panses",      # panses = pasas en catalán
    "orejones", "ciruela seca", "higo seco",
}

# Keywords de alimentos de grano legítimos que a veces caen en other_carbs
# por estar mal subgroupeados en la DB (ej: arroces de marca con subgrupo genérico).
GRAIN_KEYWORDS = {
    "arroz", "arros", "riz ", "rice",            # arroces en varios idiomas
    "spaghetti", "pasta",                         # pastas (con fat baja pueden colarse)
    "thai", "thaï",                               # arroces Thai
    "pure", "pur",                                # purés de patata (almidón, no dulce)
}

# Keywords de pan / productos panificables: hidratos legítimos aunque sean ultraprocesados
PAN_KEYWORDS = {
    "panificable", "bastonet", "barra de pan",    # preparados y grissini
    "membrillo",                                  # dulce de membrillo (fruta, no golosina)
    "pimiento",                                   # pimientos (verdura mal subgroupeada)
}

# Subgroups que corresponden a dulces/golosinas (no a hidratos legítimos).
SWEET_SUBGROUPS = {"other_carbs", "other"}


# ---------------------------------------------------------------------------
# Predicado principal
# ---------------------------------------------------------------------------

def is_sweet(food: dict) -> tuple[bool, str]:
    """
    Devuelve (True, motivo) si el alimento debe recibir flag 'sweet'.
    Devuelve (False, motivo) si debe dejarse intacto.
    """
    name_n = norm(food.get("name", ""))
    cat = food.get("category", "")
    subgroup = food.get("subgroup", "")
    cal = food.get("calories") or 0.0
    carbs = food.get("carbs") or 0.0
    prot = food.get("protein") or 0.0
    fat = food.get("fat") or 0.0
    flags = food.get("flags") or []

    # Solo interesa category carbs
    if cat != "carbs":
        return False, "category!=carbs"

    # Subgroup debe ser de dulces/golosinas
    if subgroup not in SWEET_SUBGROUPS:
        return False, f"subgroup:{subgroup}"

    # Flags protectores — no tocar
    if "condiment" in flags:
        return False, "flag:condiment"
    if "prepared" in flags:
        return False, "flag:prepared"
    if "sweet" in flags:
        return False, "ya_tiene_sweet"

    # Restricciones de macros
    if cal <= 250:
        return False, f"cal<={cal}"
    if carbs <= 60:
        return False, f"carbs<={carbs}"
    if prot >= 8:
        return False, f"prot>={prot}"
    if fat >= 5:
        return False, f"fat>={fat}"

    # Exclusiones semánticas — cereales de desayuno
    for kw in BREAKFAST_CEREAL_KEYWORDS:
        if kw in name_n:
            return False, f"cereal_desayuno:{kw}"

    # Exclusiones semánticas — frutas secas válidas
    for kw in DRIED_FRUIT_KEYWORDS:
        if kw in name_n:
            return False, f"fruta_seca:{kw}"

    # Exclusiones semánticas — granos legítimos mal subgroupeados
    for kw in GRAIN_KEYWORDS:
        if kw in name_n:
            return False, f"grano:{kw}"

    # Exclusiones semánticas — pan, panificables, membrillo, pimientos
    for kw in PAN_KEYWORDS:
        if kw in name_n:
            return False, f"pan_u_otro:{kw}"

    return True, "ok"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print(f"Leyendo {DB_PATH}...")
    with open(DB_PATH, encoding="utf-8") as f:
        data = json.load(f)

    foods = data["foods"]
    total = len(foods)

    marked = []
    skipped_already = 0

    for food in foods:
        ok, reason = is_sweet(food)
        if not ok:
            if reason == "ya_tiene_sweet":
                skipped_already += 1
            continue

        # Agregar "sweet" sin borrar flags existentes
        current_flags = food.get("flags") or []
        if "sweet" not in current_flags:
            food["flags"] = current_flags + ["sweet"]

        marked.append({
            "id": food.get("id"),
            "name": food.get("name"),
            "subgroup": food.get("subgroup"),
            "calories": food.get("calories"),
            "carbs": food.get("carbs"),
            "protein": food.get("protein"),
            "fat": food.get("fat"),
        })

    # --- Guardar database.json corregido ---
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # --- Imprimir resumen ---
    print()
    print("=" * 60)
    print("GOLOSINAS Y DULCES MARCADOS CON flag: sweet")
    print("=" * 60)
    for item in marked:
        print(
            f"  [{item['subgroup']:12}]  {item['name']:<40}"
            f"  cal:{item['calories']:>5}  carbs:{item['carbs']:>5}"
            f"  prot:{item['protein']:>4}  fat:{item['fat']:>4}"
        )

    print()
    print("=" * 60)
    print(f"  Total marcados:       {len(marked)}")
    print(f"  Ya tenían sweet:      {skipped_already}")
    print(f"  Total en database:    {total}")
    print("=" * 60)
    print()
    print("database.json guardado.")


if __name__ == "__main__":
    main()
