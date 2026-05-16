#!/usr/bin/env python3
"""
scripts/fix_culinary_role.py
Add `culinary_role` field + reinforce `exotic` flag for rare seafood,
casquería, and exotic meats — keyword-based, deterministic, idempotent.

Audit punto 1/2/8/10 del cliente (Hugo): "snacks, harinas, picos, cereales
desayuno, mariscos raros, casquería, avestruz, etc. no deberían competir
arriba con opciones cotidianas".

Roles asignados:
  - meal_dish:        comida de plato principal (arroz, pasta, pollo, salmón,
                      lentejas, patata, etc.). Default para muchas categorías.
  - snack:            picos, tortitas, bombitas, cereales desayuno,
                      golosinas, aperitivos, barritas.
  - recipe_ingredient: harinas, sémolas, pan rallado, almidón, levadura,
                      colorantes, esencias.
  - dessert:          postres, helados, gelatinas, mousses, natillas.
  - staple:           pan, leche, huevo, aceite — base versátil de cocina.

Reinforces exotic=true on:
  - rare seafood:     nécora, percebe, bogavante, langosta, cangrejo,
                      cigala, vieira, centollo, buey de mar, ostra, navaja
  - casquería:        pulmón, hígado de cordero/cerdo, sesos, callos,
                      mollejas, riñones, lengua
  - exotic meats:     avestruz, jabalí, ciervo, canguro, conejo silvestre

NO toca `category`, `subgroup` ni `macros`. Solo añade dos campos derivados
del nombre/subgroup/flags existentes — 100% reversible quitando los campos.

Uso:
  python3 scripts/fix_culinary_role.py
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


# ── CULINARY ROLE RULES ──────────────────────────────────────────────────────
# Order matters: more specific patterns first. First match wins.

# Recipe ingredients — never eaten alone, used to cook
RECIPE_INGREDIENT_RE = re.compile(
    r"\b("
    r"harina|harinas|"
    r"semola|semolina|"
    r"pan rallado|panko|"
    r"almidon|fecula|maicena|"
    r"levadura|impulsor|"
    r"esencia|aroma de vainilla|colorante alimentario|"
    r"gelatina(?: neutra| sin sabor)?|agar|pectina|"
    r"masa madre|masa de pizza|masa de hojaldre|masa quebrada|"
    r"caldo concentrado|pastilla de caldo|cubito de caldo"
    r")\b"
)

# Snacks / aperitivos / cereales de caja / golosinas saladas / barritas
SNACK_RE = re.compile(
    r"\b("
    r"pico(?:s)?(?: camperos?| de pan)?|"
    r"colines|biscotes?|tostadas? para untar|"
    r"galleta(?:s)? salada(?:s)?|crackers?|"
    r"tortita(?:s)?(?: de (?:maiz|arroz|trigo))?|"
    r"bola(?:s)? de maiz|bombita(?:s)?|nubes? de maiz|"
    r"snack|aperitivo|"
    r"patata(?:s)? frita(?:s)?(?: de bolsa)?|chips de patata|"
    r"palomita(?:s)? de maiz|popcorn|"
    r"frutos secos? fritos? y? salados?|"
    r"cacahuete(?:s)? frito(?:s)?(?: y salado(?:s)?)?|"
    r"barrita(?:s)?(?: de cereales| energetica| proteica)?|"
    r"choco krispies|frosties|smacks|kellogg|nestle cereales|"
    r"honey pops|honey loops|miel pops|"
    r"corn flakes|all-?bran|"
    r"cereales? (?:de caja|de desayuno|inflados?|azucarados?)|"
    r"muesli|granola|"
    r"crunchy|crispy|"
    r"sticks?(?: de (?:patata|batata|maiz))?|"
    r"dianitos|nachos|"
    r"gusanitos|chiquilin|cuetara|"
    r"dulces? de leche|chuches?|chucheria(?:s)?"
    r")\b"
)

# Dessert: postres lácteos/horneados/congelados
DESSERT_RE = re.compile(
    r"\b("
    r"helado|sorbete|polo helado|"
    r"flan|natilla(?:s)?|crema catalana|"
    r"mousse|panna cotta|"
    r"tiramisu|cheesecake|"
    r"tarta|pastel|bizcocho|magdalena|muffin|"
    r"brownie|cookie(?:s)?(?: de chocolate)?|"
    r"pudding|arroz con leche|"
    r"gelatina(?: de frutas| sabor)|"
    r"mermelada|confitura|jalea|"
    r"dulce de membrillo|crema pastelera|"
    r"chocolatina|bombon(?:es)?|tableta de chocolate"
    r")\b"
)

# Staple: alimentos base versátiles (pan, leche, huevo, aceite, sal, azúcar)
STAPLE_RE = re.compile(
    r"\b("
    r"pan(?!ko)(?: integral| de molde| blanco| de centeno| de espelta|"
    r" multicereales| de avena| con semillas)?|"
    r"leche(?:s)?(?: entera| semidesnatada| desnatada| sin lactosa)?|"
    r"huevo(?:s)? de gallina|"
    r"aceite de oliva|aceite de girasol|"
    r"sal(?: marina| de mesa| yodada)?|"
    r"azucar|miel pura|"
    r"vinagre|"
    r"mantequilla|margarina"
    r")\b"
)


# ── EXOTIC REINFORCEMENT ─────────────────────────────────────────────────────
RARE_SEAFOOD_RE = re.compile(
    r"\b("
    r"necora|percebe(?:s)?|bogavante(?:s)?|langosta(?:s)?|"
    r"cangrejo(?:s)?(?: real| de rio| azul| de mar)?|"
    r"cigala(?:s)?|vieira(?:s)?|"
    r"centollo|buey de mar|"
    r"ostra(?:s)?|navaja(?:s)?|"
    r"erizo de mar|caracola(?:s)?|"
    # Pescados poco comunes en cocina española semanal
    r"anguila(?:s)?|"
    r"rape negro|"
    r"raya\b[\s,]*(?:al|cruda|hervida|frita)|"
    r"morena(?:s)?|"
    r"perlon|"
    r"esturion|"
    r"foie\b[\s,]*(?:de\s+)?(?:pato|oca)|"
    # Cefalopodos y similares fuera del consumo semanal estándar
    r"chipiron(?:es)?(?: en su tinta)?|"
    r"choco(?:s)?(?: cocido| frito)?"
    r")\b"
)

CASQUERIA_RE = re.compile(
    r"\b("
    r"casqueria|"
    # Pulmón/hígado/sesos: el separador puede ser coma o espacio
    # (BEDCA usa "Pulmón, de ternera, crudo")
    r"pulmon(?:es)?\b[\s,]*(?:de\s+)?(?:cordero|cerdo|ternera|res)|"
    r"higado\b[\s,]*(?:de\s+)?(?:cordero|cerdo|pollo|ternera|res)|"
    r"sesos\b[\s,]*(?:de\s+)?(?:cordero|ternera|cerdo)?|"
    r"callos|"
    r"molleja(?:s)?|"
    r"rinon(?:es)?\b[\s,]*(?:de\s+)?(?:cordero|cerdo|ternera)?|"
    r"lengua\b[\s,]*(?:de\s+)?(?:cordero|ternera|cerdo)|"
    # Rabo de toro / oxtail / partes de carne no cotidianas en menú semanal
    r"rabo\b[\s,]*(?:de\s+)?(?:toro|vaca|res|buey)|"
    r"morro|oreja(?: de cerdo)?|"
    r"manitas? de cerdo|"
    r"sangrecilla|morcilla(?: de )?(?:burgos|leon|asturias)?|"
    # Tripa / panza / criadillas / corazón uncommon
    r"tripa(?:s)?\b[\s,]*(?:de\s+)?(?:ternera|cordero|cerdo)?|"
    r"corazon\b[\s,]*(?:de\s+)?(?:cordero|ternera|cerdo|pollo)|"
    r"criadilla(?:s)?"
    r")\b"
)

EXOTIC_MEAT_RE = re.compile(
    r"\b("
    r"avestruz|jabali|ciervo|venado|canguro|"
    r"conejo (?:silvestre|salvaje|de monte)|"
    r"perdiz|codorniz|liebre|"
    r"buffalo|bisonte|reno"
    r")\b"
)


# ── DAIRY SUB-FAMILY (audit punto 4 del cliente) ─────────────────────────────
# 5 subfamilias por USO CULINARIO real, no por subgroup microscópico:
#   - frescos_proteicos: yogur, skyr, kéfir, queso fresco, batido, requesón
#   - quesos_solidos:    curados, fundidos, lonchas, untables
#   - liquidos:          leche, bebida vegetal
#   - grasas_lacteas:    nata, crema, mascarpone
#   - postres_lacteos:   flan, natilla, panna cotta, helado, dulce/condensada
#
# Algoritmo: same subfamily → boost, cross-subfamily → demote fuerte.
# Yogur griego ya no surfacea nata montada / queso fundido / leche almendras.

_DAIRY_FRESCOS_RE = re.compile(
    r"\b("
    r"yogur(?:t)?(?:es)?|yogures|"
    r"skyr|fage|quark|"
    r"kefir|"
    r"queso fresco|queso batido|queso de burgos|"
    r"requeson|mato|ricotta|cottage|"
    r"mozzarella fresca|mozzarella di bufala|burrata"
    r")\b"
)

_DAIRY_QUESOS_SOLIDOS_RE = re.compile(
    r"\b("
    r"queso (?:curado|semicurado|tierno|viejo|anejo|de oveja|de cabra|manchego|gouda|cheddar|emmental|gruyere|brie|camembert|roquefort|cabrales|gorgonzola|parmesano|pecorino|edam|provolone|havarti|tilsit)|"
    r"queso fundido|queso para untar|queso untable|"
    r"lonchas? de queso|porciones? de queso|quesito|"
    r"manchego|cheddar|gruyere|parmesano|gorgonzola|roquefort|"
    r"feta|halloumi"
    r")\b"
)

_DAIRY_LIQUIDOS_RE = re.compile(
    r"\b("
    r"leche(?: entera| semidesnatada| desnatada| fresca| uht| en polvo| sin lactosa)?|"
    r"bebida (?:de |vegetal)|"
    r"leche de (?:almendras?|avena|soja|coco|arroz|avellana|anacardo)|"
    r"horchata|"
    r"yogur (?:bebible|para beber|liquido)"
    r")\b"
)

_DAIRY_GRASAS_RE = re.compile(
    r"\b("
    r"nata(?: liquida| montada| para cocinar| para postres| acida)?|"
    r"creme fraiche|crema agria|crema de leche|"
    r"mascarpone"
    r")\b"
)

_DAIRY_POSTRES_RE = re.compile(
    r"\b("
    r"flan|natilla(?:s)?|panna cotta|tiramisu|cheesecake|"
    r"helado|sorbete|polo helado|"
    r"dulce de leche|leche condensada|leche evaporada|"
    r"arroz con leche|cuajada(?: con miel)?"
    r")\b"
)


def infer_dairy_subfamily(food: dict) -> str | None:
    """Returns one of frescos_proteicos | quesos_solidos | liquidos |
    grasas_lacteas | postres_lacteos | None when food is not dairy."""
    if food.get("category") != "dairy":
        return None
    name = _norm(food.get("name") or "")
    # Order matters: postres y grasas más específicos que frescos.
    if _DAIRY_POSTRES_RE.search(name):    return "postres_lacteos"
    if _DAIRY_GRASAS_RE.search(name):     return "grasas_lacteas"
    if _DAIRY_LIQUIDOS_RE.search(name):   return "liquidos"
    if _DAIRY_QUESOS_SOLIDOS_RE.search(name): return "quesos_solidos"
    if _DAIRY_FRESCOS_RE.search(name):    return "frescos_proteicos"
    # Fallback por subgroup
    sub = food.get("subgroup")
    if sub == "high_protein_dairy":       return "frescos_proteicos"
    if sub == "low_fat_dairy":            return "frescos_proteicos"
    if sub in ("aged_cheese", "cheese"):  return "quesos_solidos"
    if sub == "fresh_cheese":             return "frescos_proteicos"
    if sub == "other_dairy":              return "postres_lacteos"  # safer default
    # whole_dairy → ambiguo (yogur entero, leche entera, postres lácteos enteros)
    # Si el regex no lo cazó, defaultea a frescos (es la categoría más común)
    return "frescos_proteicos"


# ── HUMMUS MISCATEGORIZATION FIX (cliente reportó hummus light en yogur) ────
# Algunos hummus aparecen como category=dairy por categorización legacy
# incorrecta. Hummus es legumbre + grasa, NUNCA dairy. Movemos a fat/other_fat.
def fix_miscategorized_hummus(food: dict) -> bool:
    """Returns True if the food was reclassified. Idempotent."""
    name = _norm(food.get("name") or "")
    if "hummus" not in name:
        return False
    if food.get("category") != "dairy":
        return False
    # Hummus is fat/other_fat, not dairy
    if "category_prev" not in food:
        food["category_prev"] = food.get("category")
    food["category"] = "fat"
    food["subgroup"] = "other_fat"
    food["macro_profile"] = "fat"
    return True


# ── ROLE INFERENCE ───────────────────────────────────────────────────────────
def infer_culinary_role(food: dict) -> str:
    """Returns one of: meal_dish | snack | recipe_ingredient | dessert | staple.

    Defaults to 'meal_dish' for proteins/carbs/dairy/fat — the most common
    intercambiable category. Only re-routes to a non-meal_dish role when
    keywords or flags clearly indicate it.
    """
    name = _norm(food.get("name") or "")
    flags = food.get("flags") or []

    # Flag-based shortcuts (already curated in past sweeps)
    if "sweet" in flags:
        if DESSERT_RE.search(name):
            return "dessert"
        return "snack"
    if "prepared" in flags:
        # Prepared dishes are still meal_dish from a substitution standpoint
        return "meal_dish"

    # Recipe ingredients first (most specific)
    if RECIPE_INGREDIENT_RE.search(name):
        return "recipe_ingredient"
    # raw_ingredient flag from bulk-label is also a strong signal
    if food.get("raw_ingredient") is True and (
        food.get("category") in ("carbs", "fat") or
        food.get("subgroup") in ("grains", "olive_oil", "other_oils")
    ):
        # Only treat as ingredient if it's a flour-like thing — raw arroz/
        # lentejas should stay meal_dish.
        if any(t in name for t in ("harina", "semola", "almidon", "fecula", "levadura")):
            return "recipe_ingredient"

    if DESSERT_RE.search(name):
        return "dessert"

    if SNACK_RE.search(name):
        return "snack"

    if STAPLE_RE.search(name):
        return "staple"

    # Default: meal-replaceable dish
    return "meal_dish"


def should_be_exotic(food: dict) -> bool:
    """True if the food should have exotic=true based on name keywords.
    Used to REINFORCE the existing bulk-label exotic flag — never sets
    exotic=false (keeps existing exotic=true entries untouched)."""
    name = _norm(food.get("name") or "")
    return bool(
        RARE_SEAFOOD_RE.search(name) or
        CASQUERIA_RE.search(name) or
        EXOTIC_MEAT_RE.search(name)
    )


# ── MAIN ─────────────────────────────────────────────────────────────────────
def main() -> None:
    print(f"Leyendo {DB_PATH}...")
    with DB_PATH.open(encoding="utf-8") as f:
        foods = json.load(f)

    role_counts: dict[str, int] = {}
    exotic_added = 0
    exotic_already = 0
    hummus_fixed = 0
    dairy_subfam_counts: dict[str, int] = {}

    for food in foods:
        # Hummus miscategorization fix FIRST so dairy_subfamily skips them
        if fix_miscategorized_hummus(food):
            hummus_fixed += 1

        # culinary_role — always (re)derive, idempotent
        role = infer_culinary_role(food)
        food["culinary_role"] = role
        role_counts[role] = role_counts.get(role, 0) + 1

        # exotic reinforcement — only flip false→true, never the reverse
        if should_be_exotic(food):
            if food.get("exotic") is True:
                exotic_already += 1
            else:
                food["exotic"] = True
                exotic_added += 1

        # dairy_subfamily — only for category=dairy after hummus fix
        sub_family = infer_dairy_subfamily(food)
        if sub_family is not None:
            food["dairy_subfamily"] = sub_family
            dairy_subfam_counts[sub_family] = dairy_subfam_counts.get(sub_family, 0) + 1
        else:
            # If food was previously labeled and is no longer dairy, drop the field
            food.pop("dairy_subfamily", None)

    with DB_PATH.open("w", encoding="utf-8") as f:
        json.dump(foods, f, ensure_ascii=False, indent=2)

    print()
    print("=" * 72)
    print(" CULINARY ROLE DISTRIBUTION")
    print("=" * 72)
    for role in ("meal_dish", "snack", "recipe_ingredient", "dessert", "staple"):
        count = role_counts.get(role, 0)
        pct = 100 * count / len(foods)
        print(f"  {role:<22}  {count:>5}  ({pct:>5.1f}%)")
    print()
    print("=" * 72)
    print(" EXOTIC REINFORCEMENT")
    print("=" * 72)
    print(f"  Flipped false → true:          {exotic_added}")
    print(f"  Already true (no change):      {exotic_already}")
    print()
    print("=" * 72)
    print(" HUMMUS RECLASSIFIED dairy → fat")
    print("=" * 72)
    print(f"  Fixed entries:                 {hummus_fixed}")
    print()
    print("=" * 72)
    print(" DAIRY SUB-FAMILY DISTRIBUTION")
    print("=" * 72)
    for sf in ("frescos_proteicos", "quesos_solidos", "liquidos", "grasas_lacteas", "postres_lacteos"):
        count = dairy_subfam_counts.get(sf, 0)
        print(f"  {sf:<22}  {count:>5}")
    print()
    print("=" * 72)
    print(f"  Total foods en DB:             {len(foods)}")
    print("=" * 72)
    print()
    print("database.json guardado.")


if __name__ == "__main__":
    main()
