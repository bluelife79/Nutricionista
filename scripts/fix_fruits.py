#!/usr/bin/env python3
"""
scripts/fix_fruits.py
Crea la categoría 'fruits' para frutas mal clasificadas en database.json.

POR QUÉ:
  Hoy las frutas viven en `category: "carbs"` mezcladas con arroz, pasta,
  pan y legumbres. Cuando una clienta busca alternativas a una manzana, le
  aparece arroz blanco como intercambio — clínicamente absurdo. La dieta
  mediterránea española pivota sobre la fruta diaria, así que se merece
  su propia categoría como ya tienen las verduras.

LÓGICA:
  Un alimento es fruta si cumple TODAS:
    1. Su nombre contiene un keyword de fruta REAL (manzana, naranja, etc.)
    2. NO contiene keywords de exclusión (yogur, smoothie, mermelada,
       barrita, papilla, etc. — productos compuestos)
    3. No tiene flags: condiment, prepared, sweet, hidden
    4. Macros razonables (frutas frescas o desecadas)
    5. No está ya en una categoría protegida (vegetables, fat, postres_proteicos)

  Macros aceptados:
    - Frutas frescas: cal < 100, prot < 2.5, fat < 3, carbs >= 4
    - Frutas desecadas (dátil, pasas, etc.): cal hasta 380

REGLAS DE NEGOCIO ACORDADAS CON EL CLIENTE:
  - Subgrupos en español, simples para que el cliente los entienda
  - Plátano va en 'tropical' (es la convención botánica)
  - Zumos 100% naturales SE QUEDAN en carbs (no son fruta entera, perdieron fibra)
  - Frutas en almíbar/conserva SE QUEDAN en carbs (tienen azúcar añadido)
  - Aceitunas → category 'fat' (botánicamente fruta pero clínicamente grasa)
  - Coco → category 'fat' (alto en grasa)
  - Tomate → category 'vegetables' (ya clasificado)
  - Aguacate → category 'fat' (ya clasificado)

POLÍTICA: Idempotente — corre 1 o 100 veces y produce el mismo resultado.

Usage:
  python3 scripts/fix_fruits.py
"""

import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "database.json"


# ---------------------------------------------------------------------------
# Normalización
# ---------------------------------------------------------------------------

def norm(s: str) -> str:
    s = (s or "").lower().strip()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# ---------------------------------------------------------------------------
# Keywords de FRUTAS REALES — agrupadas por subgrupo
# ---------------------------------------------------------------------------

FRUIT_SUBGROUPS = {
    # Frutas con pepitas: manzana, pera, membrillo
    "pepita": [
        "manzana", "pera", "membrillo",
    ],
    # Cítricos: naranja, mandarina, limón, pomelo, lima
    "citricos": [
        "naranja", "mandarina", "limon", "pomelo", "lima", "clementina",
    ],
    # Frutos del bosque: fresa, frambuesa, arándano, mora, grosella
    "frutos_bosque": [
        "fresa", "fresas", "frambuesa", "arandano", "arandanos",
        "mora", "moras", "grosella", "grosellas",
    ],
    # Tropicales: mango, kiwi, piña, plátano, papaya, maracuyá, guayaba
    "tropical": [
        "mango", "kiwi", "piña", "pina", "platano", "banana",
        "papaya", "maracuya", "guayaba", "carambola", "rambutan",
    ],
    # Frutas con hueso: melocotón, ciruela, cereza, albaricoque
    "hueso": [
        "melocoton", "ciruela", "cereza", "albaricoque", "albaricoques",
        "nectarina", "paraguaya",
    ],
    # Melón y sandía
    "melon_sandia": [
        "melon", "sandia",
    ],
    # Uva fresca
    "uva": [
        "uva", "uvas",
    ],
    # Frutas desecadas (mayor densidad calórica)
    "fruta_seca": [
        "datil", "datiles", "orejon", "orejones",
        "ciruela seca", "ciruela pasa", "ciruelas pasas", "ciruelas secas",
        "higo seco", "higos secos", "higo desecado",
        "uva pasa", "uvas pasas", "pasa sultana", "pasas sultanas",
        "pasas moscatel", "pasas thompson", "pasas de corinto",
        "deshidrat",  # genérico para deshidratadas
        "desecad",   # genérico para desecadas
    ],
    # Otras frutas (granada, higo fresco, caqui, chirimoya, lichi)
    "otra_fruta": [
        "granada", "caqui", "chirimoya", "lichi", "litchi",
        "higo",  # higo fresco (los higos secos los pesca el subgrupo dried)
        "breva", "brevas",
        "nispero", "nisperos",
    ],
}

# Lista plana de todos los keywords (para detección rápida)
ALL_FRUIT_KEYWORDS = [kw for kws in FRUIT_SUBGROUPS.values() for kw in kws]


# ---------------------------------------------------------------------------
# Exclusiones — productos que mencionan fruta pero NO son fruta
# ---------------------------------------------------------------------------

# Si el nombre contiene CUALQUIERA, no es fruta
NOT_FRUIT_PATTERNS = [
    # ── Lácteos saborizados con fruta ────────────────────────────────────
    "yogur", "yoghourt", "yoghurt", "yogures",
    "yopro", "bifidus", "biactive", "biactiv", "cremoso",
    "kefir", "kéfir", "skyr", "quark",
    "queso", "leche",
    "petit", "petite",
    "bebee", "drink",
    "cuidacol", "sensacol", "vitalcol",
    "l casei", "l. casei",

    # ── Bebidas/zumos/smoothies (van a carbs) ────────────────────────────
    "zumo", "nectar", "néctar", "smoothie", "batido", "shake",
    "bebida", "beguda", "boisson", "jus",
    "limonada", "lemonade",
    "iced tea", "té sabor", "te sabor", "sabor te",
    # Bebidas con gas / isotónicas / suplementos
    "fresh gas", " con gas", "fresh ", " gas ",
    "isoclassic", "iso classic", "isotonic", "isotónic", "isotonico",
    "get move", "energy", "energet",
    "pulp", "pulp'",
    "sanus", "vital ",
    "magnesio", "esteroles", "vitamina",
    "preparado",

    # ── Postres / mermeladas / dulces ───────────────────────────────────
    "mermelada", "confitura", "jalea",
    "gelatina", "gel ", "gellytina", "gelifica", "jelly",
    "almibar", "almíbar",
    "mousse", "helado", "sorbete", "granizado",
    "compota", "puré", "pure de",
    "tarta", "magdalena", "bizcocho", "galleta", "galletitas", "donuts",
    "muffin", "brownie",
    "barrita", "barra de cereal",
    "postre", "postres",
    "calipo", "polo", "frigo",  # marcas de helado
    "tarrito", "potito",         # comida bebé
    "bebe fruta", "bebé fruta",

    # ── Cereales / muesli / granola con fruta ────────────────────────────
    "muesli", "granola", "cereal", "cereales", "copos",
    "crunchy", "crujiente", "crousty", "premium muesli",
    "fibra 5", "fibra5", "fibra y", "blevit",
    "papilla",
    "cheerios", "snack",

    # ── Snacks procesados ────────────────────────────────────────────────
    "fruit cie", "fruit & cie", "fruit&cie", "fruity",
    "fruita", "frutilin", "fruit to go",

    # ── Mezclas con frutos secos (van a fat) ─────────────────────────────
    "frutos secos", "y frutos secos", "garrapinad", "garrapiñad",
    "almendra y", "nuez y", "nueces y",
    "pipas", "pepitas",

    # ── Aceites/vinagres con sabor frutado ───────────────────────────────
    "aceite", "aceites",
    "vinagre", "vinagreta",
    "aderezo", "salsa", "saus", "sauce",
    "balsamic", "balsámico", "balsamico",
    "crema de", "pasta de",

    # ── Golosinas y dulces ───────────────────────────────────────────────
    "chuche", "chuches", "gominola", "golosina", "caramelo", "caramelos",
    "chic kles", "chickles", "chicl", "smint", "tic tac",
    "dulcipica", "spaghetti pika", "pika", "picante",
    "adoquin", "ladrillo", "cinta", "lapiz", "tubitos", "conos",
    "rellenitos", "rellenito", "rellenos",
    "mix", "balla", "gel'hada",
    "fondant", "marshmallow", "nougat",

    # ── Decorados/glaseados ──────────────────────────────────────────────
    "glaseada", "glaseado", "confitada", "confitado",
    "fruta confitada", "fruta glaseada",

    # ── Fruta + queso/nata mezclas (postres lácteos) ─────────────────────
    "con queso", "queso fresco con", "con nata", "nata fresa", "fresa nata",
    "fresas con nata", "queso fresca",

    # ── Productos proteicos / suplementos ───────────────────────────────
    "hyperprotein", "hyperproteic", "high protein",
    "proteinas", "proteínas", "shake protein",

    # ── Miel y siropes ──────────────────────────────────────────────────
    "miel", "sirope", "jarabe",

    # ── Bombones / pastas dulces ────────────────────────────────────────
    "bombon", "bombón", "pasta basta", "pastas",
    "negro", "rulito",

    # ── Palomitas / snacks salados con fruta ────────────────────────────
    "palomitas", "kikos",

    # ── Comidas con fruta como acompañamiento ───────────────────────────
    "cerdo y manzana", "pollo con manzana", "pavo con", "pato con",
    "ensalada con", "arroz con",

    # ── "Sabor X" → es producto saborizado, no la fruta ─────────────────
    "sabor a ", "sabor ", " sabor ",  # "Galletitas sabor limón"

    # ── Mezclas fruta + verdura (no son fruta pura) ─────────────────────
    "zanahoria", "remolacha", "espinaca", "pepino", "tomate",
    "jengibre", "menta", "albahaca", "perejil",
    "y goui",  # "Manzana remolacha y goui"

    # ── Variantes regionales y misc ─────────────────────────────────────
    "duo ", "exotic", "exotico", "exoticos", "tropical fruits",
    "delicious", "delicia",
    "edulcoran", "edulcorad",
    "polvo para", "polvo de",

    # ── Aromatizaciones / sabores añadidos (postres lácteos disfrazados)
    "a la vainilla", "vainilla",
    "a la canela", "canela",
    "a la menta", " menta ",

    # ── Concentrados (no son fruta entera) ──────────────────────────────
    "concentrado", "concentrada",
    "a partir de concentrado",
    "morango",  # portugués para fresa, suelen ser productos no españoles
]


# ---------------------------------------------------------------------------
# Categorías protegidas — nunca se mueven a fruits
# ---------------------------------------------------------------------------

PROTECTED_CATEGORIES = {"vegetables", "fat", "postres_proteicos", "protein"}

# Subgrupos protegidos (lácteos especiales)
PROTECTED_SUBGROUPS = {
    "basic_dairy", "high_protein_dairy", "other_dairy",
    "meat", "fish", "eggs",
}


# ---------------------------------------------------------------------------
# Lógica
# ---------------------------------------------------------------------------

CRITICAL_FLAGS = {"condiment", "prepared", "sweet"}


def has_critical_flag(food: dict) -> bool:
    flags = set(food.get("flags") or [])
    return bool(flags & CRITICAL_FLAGS)


def is_dried_fruit(name_n: str) -> bool:
    """True si el nombre indica fruta desecada (mayor densidad calórica)."""
    return any(kw in name_n for kw in FRUIT_SUBGROUPS["fruta_seca"])


def has_fruit_keyword(name_n: str) -> bool:
    """True si el nombre contiene un keyword de fruta real."""
    # Buscar palabra entera para evitar falsos positivos como "espinaca" → "pina"
    for kw in ALL_FRUIT_KEYWORDS:
        if re.search(rf"\b{re.escape(kw)}\b", name_n):
            return True
    return False


def has_exclusion_keyword(name_n: str) -> bool:
    """True si el nombre contiene un keyword de exclusión (no es fruta)."""
    return any(kw in name_n for kw in NOT_FRUIT_PATTERNS)


def classify_subgroup(name_n: str) -> str:
    """Decide el subgrupo botánico según el primer match."""
    # Primero chequear desecadas (prioridad alta porque "uva" matchea ambos)
    for kw in FRUIT_SUBGROUPS["fruta_seca"]:
        if kw in name_n:
            return "fruta_seca"
    # Después el resto en orden
    for subgroup, kws in FRUIT_SUBGROUPS.items():
        if subgroup == "fruta_seca":
            continue
        for kw in kws:
            if re.search(rf"\b{re.escape(kw)}\b", name_n):
                return subgroup
    return "otra_fruta"


def is_fruit(food: dict) -> tuple[bool, str]:
    """
    Decide si un alimento es fruta. Retorna (es_fruta, motivo).
    """
    # 1. Categoría protegida
    if food.get("category") in PROTECTED_CATEGORIES:
        return False, f"cat protegida: {food.get('category')}"
    if food.get("subgroup") in PROTECTED_SUBGROUPS:
        return False, f"sub protegido: {food.get('subgroup')}"

    # 2. Flags críticos
    if has_critical_flag(food):
        return False, "tiene flag condiment/prepared/sweet"

    # 3. Macros
    cal = food.get("calories") or 0
    prot = food.get("protein") or 0
    fat = food.get("fat") or 0
    carbs = food.get("carbs") or 0

    if cal <= 0:
        return False, "sin calorías"

    name_n = norm(food.get("name", ""))
    if not name_n:
        return False, "nombre vacío"

    # 4. Keyword de fruta (en cualquier caso debe estar)
    if not has_fruit_keyword(name_n):
        return False, "sin keyword de fruta"

    # 5. Exclusiones de productos compuestos
    if has_exclusion_keyword(name_n):
        return False, "exclusión de producto compuesto"

    # 6. Detectar si es fruta desecada (umbrales más altos)
    dried = is_dried_fruit(name_n)

    # 7. Restricciones de macros según tipo
    if dried:
        # Frutas desecadas: hasta 380 cal, prot<5, fat<5
        if cal > 380:
            return False, f"desecada cal>{cal}"
        if prot > 5:
            return False, f"desecada prot>{prot}"
        if fat > 5:
            return False, f"desecada fat>{fat}"
    else:
        # Frutas frescas: cal<100, prot<2.5, fat<3, carbs>=4
        if cal > 100:
            return False, f"fresca cal>{cal}"
        if prot > 2.5:
            return False, f"fresca prot>{prot}"
        if fat > 3:
            return False, f"fresca fat>{fat}"
        if carbs < 4:
            return False, f"fresca carbs<{carbs}"

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

    previously_fruits = sum(1 for f in foods if f.get("category") == "fruits")
    print(f"  → Alimentos con category=fruits antes: {previously_fruits}")

    modified = []
    by_original_cat = defaultdict(int)
    by_subgroup = defaultdict(int)

    for food in foods:
        ok, reason = is_fruit(food)
        if not ok:
            # Si ya estaba como fruits y ahora no cumple → SACARLO
            if food.get("category") == "fruits":
                # Volver a carbs como default (era el comportamiento previo)
                food["category"] = "carbs"
                food["subgroup"] = "fruit"
                food["macro_profile"] = "carbs"
            continue

        old_cat = food.get("category", "?")
        old_sub = food.get("subgroup") or "?"

        name_n = norm(food.get("name", ""))
        new_sub = classify_subgroup(name_n)

        food["category"] = "fruits"
        food["subgroup"] = new_sub
        food["macro_profile"] = "carbs"  # frutas son fuente de carbohidratos

        by_original_cat[old_cat] += 1
        by_subgroup[new_sub] += 1
        modified.append({
            "id": food.get("id"),
            "name": food.get("name"),
            "old_cat": old_cat,
            "old_sub": old_sub,
            "new_sub": new_sub,
        })

    # Guardar
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # Reporte
    total_modified = len(modified)
    total_fruits = sum(1 for f in foods if f.get("category") == "fruits")

    print()
    print("=" * 70)
    print(f"FRUTAS RECLASIFICADAS")
    print("=" * 70)
    print(f"Total alimentos clasificados como 'fruits': {total_fruits}")
    print()
    print("Movimientos por categoría origen:")
    for cat, n in sorted(by_original_cat.items(), key=lambda x: -x[1]):
        print(f"  {cat:20} → fruits: {n}")
    print()
    print("Distribución por subgrupo:")
    for sub, n in sorted(by_subgroup.items(), key=lambda x: -x[1]):
        print(f"  {sub:20} {n}")

    print()
    print("=" * 70)
    print(f"MUESTRA (primeros 30):")
    print("=" * 70)
    for item in modified[:30]:
        arrow = f"[{item['old_cat']:8}→fruits]"
        print(f"  {arrow} sub:{item['new_sub']:15} | {item['name']}")
    if len(modified) > 30:
        print(f"  ... y {len(modified) - 30} más")

    print()
    print(f"Total alimentos en BD: {total}")
    print("database.json guardado.")


if __name__ == "__main__":
    main()
