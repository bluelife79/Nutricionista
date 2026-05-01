#!/usr/bin/env python3
"""
scripts/fix_categories.py
Crea la categoría 'vegetables' para verduras mal clasificadas en database.json.

Las verduras estaban repartidas entre 'protein' y 'carbs' según cuál macro era
dominante proporcionalmente — criterio clínicamente incorrecto. Este script
identifica verduras por keyword semántico + restricciones de macros y las
reclasifica con category/subgroup/macro_profile correctos.

Reglas:
  1. Un alimento es verdura si cumple TODOS los criterios de macros Y tiene
     keyword de verdura en el nombre normalizado, SIN keywords de exclusión.
  2. Los alimentos reclasificados reciben category='vegetables',
     subgroup según familia botánica, macro_profile='calories'.
  3. Cualquier alimento que no cumpla Regla 1 se deja intacto.
  4. Alimentos con flags 'condiment' o 'prepared' nunca se tocan.
  5. Alimentos con subgroup en {meat, fish, eggs} nunca se tocan
     (son platos preparados que contienen verdura pero no SON verdura).

Salidas:
  database.json   — corregido in-place (git controla versiones)
"""

import json
import re
import unicodedata
from collections import defaultdict
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
# Keywords
# ---------------------------------------------------------------------------

# Palabras que indican que el alimento ES una verdura/hortaliza/seta.
# Se buscan como substrings en el nombre normalizado.
VEGETABLE_KEYWORDS = {
    "acelga", "achicoria", "ajetes", "alcachofa", "apio",
    "berenjena", "berro", "berza", "brecol", "brocoli",
    "calabacin", "calabaza", "cardo", "canonigos", "canonigo",
    "cebolla", "cebolleta", "cebollino", "coliflor",
    "col rizada", "col de bruselas", "col blanca", "col lombarda",
    "endibia", "endib", "escarola", "escarol", "esparrago",
    "espinaca", "grelo", "hinojo",
    "judia verde", "judias verdes", "judias verde",
    "lechuga", "lombarda", "nabo", "pepino", "perejil",
    "pimiento", "puerro", "rabano", "remolacha", "repollo",
    "rucula", "rucola", "radicheta",
    "seta", "champinon", "niscalo", "portobello", "shiitake", "boletus",
    "tomate", "zanahoria", "verdura", "verdure", "hortali",
    "pak choi", "germinado", "germinada",
    "brote", "microgreens",
    "guisante", "ejotes",
    "habichuelas",
    "alcachofas", "espinacas", "acelgas",
    "cebollino",
    # Nuevas incorporaciones
    "borraja",                      # borraja (leafy herb)
    "chayote",                      # chayote (fruiting veg)
    "bambu",                        # brotes de bambú
    "chile",                        # chile/ají (fruiting veg, tipo pimiento picante)
    "guindilla",                    # guindilla (chile ibérico)
    "coles",                        # plural de col (col de bruselas, etc.)
    "menestra",                     # menestra de verduras
    "florete",                      # floretes de brocoli/coliflor
    # Catalán / variantes regionales
    "carxofa",                      # alcachofa en catalán
    "pebrot",                       # pimiento en catalán
    "pastanaga", "pastanague",      # zanahoria en catalán
    "espinacs",                     # espinacas en catalán
    "carbasso",                     # calabacín en catalán
}

# "ajo" suelto: solo si es palabra entera o al inicio/final.
# Evitar falsos positivos como "ajoarriero", "ajoblanco" que son salsas.
AJO_PATTERN = re.compile(r"\bajo\b")

# "col " (con espacio) para evitar que "coliflor" se capture por "col" solo.
COL_PATTERN = re.compile(r"\bcol\b")

# Exclusiones — si el nombre tiene alguna de estas palabras, NO es verdura.
# IMPORTANTE: usar word-boundary regex para evitar falsos positivos como:
#   "pina" dentro de "espinacas", "pasta" dentro de "pastanagues" (zanahoria en catalán).
_FRUIT_WORDS = {
    "manzana", "pera", "naranja", "limon", "platano", "fresa", "uva", "melon",
    "sandia", "pina", "mango", "kiwi", "cereza", "ciruela", "melocoton",
    "albaricoque", "higo", "frambuesa", "arandano", "mora", "papaya", "caqui",
    "granada", "pomelo", "mandarina", "fruta", "datil", "pasa", "orejon",
}
FRUIT_PATTERN = re.compile(
    r"\b(?:" + "|".join(re.escape(w) for w in sorted(_FRUIT_WORDS, key=len, reverse=True)) + r")\b"
)

LEGUME_KEYWORDS = {
    "lenteja", "garbanzo", "alubia", "judion", "tofu", "tempeh",
    "habas secas", "legumbre", "hummus",
    # soja solo como planta seca — no afecta a "soja germinada" que queremos capturar
    # lo tratamos abajo con lógica específica
}

_GRAIN_WORDS = {
    "arroz", "harina", "avena", "trigo", "cebada",
    "quinoa", "quinua", "mijo", "centeno", "cereal", "galleta", "bizcocho",
    "maiz", "fideos", "pasta", "lasagna", "gnocchi",
}
# "pasta" usa word boundary para no atrapar "pastanagues" (zanahoria en catalán).
GRAIN_PATTERN = re.compile(
    r"\b(?:" + "|".join(re.escape(w) for w in sorted(_GRAIN_WORDS, key=len, reverse=True)) + r")\b"
)

# Términos de salsa/condimento en el nombre (idioma neutro)
SAUCE_KEYWORDS = {
    "saus", "sauce", "ketchup", "sofrito", "sofrit",
}

# "pan " — solo como palabra para evitar "pimiento" → falso negativo
PAN_PATTERN = re.compile(r"\bpan\b")

# Subgroups que indican plato preparado con proteína animal — excluir siempre
ANIMAL_SUBGROUPS = {"meat", "fish", "eggs"}

# Keywords de proteína animal en nombre — excluir si el alimento los tiene
# y además el subgroup no es ya de verdura
# (evita excluir "tomate" legítimo)
ANIMAL_NAME_KEYWORDS = {
    "pollo", "pavo", "ternera", "cerdo", "jamon", "lomo", "burger",
    "bacalao", "salmon", "merluza", "atun", "caballa",
    "langostino", "calamar", "sepia", "mejillon", "ostra", "pulpo",
    # "gambas" — algunos son salteados con gambas pero la verdura domina,
    # los excluimos igualmente porque son platos mixtos
    "gambas",
}

# "pescado" — word boundary
PESCADO_PATTERN = re.compile(r"\bpescado\b")

# Bebidas lácteas que pueden tener keyword vegetal en el nombre
DAIRY_SUBGROUPS = {"basic_dairy", "high_protein_dairy", "other_dairy"}


# ---------------------------------------------------------------------------
# Clasificación de subgrupo
# ---------------------------------------------------------------------------

def classify_subgroup(name_n: str) -> str:
    """Determina el subgrupo de vegetales a partir del nombre normalizado."""
    leafy = {
        "lechuga", "espinaca", "espinacas", "espinacs", "rucula", "rucola", "radicheta",
        "canonigo", "canonigos", "berro", "escarola", "escarol",
        "endibia", "endib", "col rizada", "acelga", "acelgas", "grelo", "berza",
        "achicoria", "borraja",
    }
    cruciferous = {
        "brocoli", "brecol", "coliflor", "repollo", "lombarda", "col de bruselas",
        "col blanca", "col lombarda", "coles", "florete",
    }
    allium = {
        "cebolla", "cebolleta", "cebollino", "puerro", "ajetes",
    }
    mushroom = {
        "seta", "champinon", "niscalo", "portobello", "shiitake", "boletus",
    }
    root_veg = {
        "zanahoria", "remolacha", "nabo", "rabano",
        "pastanaga", "pastanague",     # catalán
    }
    fruiting_veg = {
        "tomate", "pimiento", "berenjena", "calabacin", "calabaza", "pepino",
        "chayote", "chile", "guindilla",
        "pebrot",                       # catalán
        "carbasso",                     # catalán (calabacín)
    }
    stalk_veg = {
        "esparrago", "apio", "hinojo", "alcachofa", "alcachofas", "cardo",
        "bambu", "carxofa",             # catalán (alcachofa)
    }

    for kw in leafy:
        if kw in name_n:
            return "leafy"
    for kw in cruciferous:
        if kw in name_n:
            return "cruciferous"
    # "ajo" → allium, pero solo palabra entera
    if AJO_PATTERN.search(name_n):
        return "allium"
    for kw in allium:
        if kw in name_n:
            return "allium"
    for kw in mushroom:
        if kw in name_n:
            return "mushroom"
    for kw in root_veg:
        if kw in name_n:
            return "root_veg"
    for kw in fruiting_veg:
        if kw in name_n:
            return "fruiting_veg"
    for kw in stalk_veg:
        if kw in name_n:
            return "stalk_veg"
    return "other_veg"


# ---------------------------------------------------------------------------
# Predicado principal
# ---------------------------------------------------------------------------

def is_vegetable(food: dict) -> tuple[bool, str]:
    """
    Devuelve (True, motivo) si el alimento debe reclasificarse como verdura.
    Devuelve (False, motivo) si debe dejarse intacto.
    """
    name = food.get("name", "")
    name_n = norm(name)
    cal = food.get("calories") or 9999.0
    prot = food.get("protein") or 0.0
    fat = food.get("fat") or 0.0
    flags = food.get("flags") or []
    subgroup = food.get("subgroup", "")

    # Flags protectores
    if "condiment" in flags:
        return False, "flag:condiment"
    if "prepared" in flags:
        return False, "flag:prepared"

    # Subgroup de proteína animal → plato mixto, no verdura pura
    if subgroup in ANIMAL_SUBGROUPS:
        return False, f"subgroup:{subgroup}"

    # Subgroup de lácteo → no es verdura aunque tenga keyword vegetal
    if subgroup in DAIRY_SUBGROUPS:
        return False, f"subgroup:{subgroup}"

    # Restricciones de macros
    if cal >= 65:
        return False, f"cal>={cal}"
    if prot >= 10:
        return False, f"prot>={prot}"
    if fat >= 8:
        return False, f"fat>={fat}"

    # Exclusiones semánticas
    if FRUIT_PATTERN.search(name_n):
        return False, "keyword:fruta"
    if any(kw in name_n for kw in LEGUME_KEYWORDS):
        return False, "keyword:legumbre"
    # soja sin "germinada" → legumbre; soja germinada → verdura
    if "soja" in name_n and "germinada" not in name_n and "germinado" not in name_n:
        return False, "keyword:soja_seca"
    if GRAIN_PATTERN.search(name_n):
        return False, "keyword:grano"
    if PAN_PATTERN.search(name_n):
        return False, "keyword:pan"
    if any(kw in name_n for kw in SAUCE_KEYWORDS):
        return False, "keyword:salsa"

    # Keywords de proteína animal en nombre (platos mixtos que escaparon el subgroup check)
    if any(kw in name_n for kw in ANIMAL_NAME_KEYWORDS):
        return False, "keyword:animal"
    if PESCADO_PATTERN.search(name_n):
        return False, "keyword:pescado"

    # Debe tener al menos un keyword de verdura
    has_veg_kw = any(kw in name_n for kw in VEGETABLE_KEYWORDS)
    if not has_veg_kw:
        # "ajo" como palabra entera
        has_veg_kw = bool(AJO_PATTERN.search(name_n))
    if not has_veg_kw:
        # "col" como palabra entera (col de milano, col china, etc.)
        has_veg_kw = bool(COL_PATTERN.search(name_n))

    if not has_veg_kw:
        return False, "no_keyword_vegetal"

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

    modified = []
    by_original_cat: dict[str, int] = defaultdict(int)

    for food in foods:
        ok, reason = is_vegetable(food)
        if not ok:
            continue

        old_category = food.get("category", "?")
        old_subgroup = food.get("subgroup", "?")
        old_macro_profile = food.get("macro_profile", "?")

        name_n = norm(food.get("name", ""))
        new_subgroup = classify_subgroup(name_n)

        food["category"] = "vegetables"
        food["subgroup"] = new_subgroup
        food["macro_profile"] = "calories"

        by_original_cat[old_category] += 1
        modified.append({
            "id": food.get("id"),
            "name": food.get("name"),
            "old_category": old_category,
            "old_subgroup": old_subgroup,
            "old_macro_profile": old_macro_profile,
            "new_subgroup": new_subgroup,
        })

    # --- Guardar database.json corregido ---
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # --- Imprimir resumen ---
    total_modified = len(modified)
    print()
    print("=" * 50)
    print("CORRECCIONES APLICADAS")
    print("=" * 50)
    for orig_cat, count in sorted(by_original_cat.items()):
        print(f"  {orig_cat} → vegetables: {count} alimentos")
    print(f"  Total modificados: {total_modified}")

    print()
    print("=" * 50)
    print("DETALLE")
    print("=" * 50)
    for item in modified:
        arrow = f"[{item['old_category']}→vegetables]"
        print(f"{arrow} {item['name']}  (subgroup: {item['old_subgroup']} → {item['new_subgroup']})")

    print()
    print(f"database.json guardado con {total} alimentos.")


if __name__ == "__main__":
    main()
