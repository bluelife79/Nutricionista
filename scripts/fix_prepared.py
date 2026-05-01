#!/usr/bin/env python3
"""
scripts/fix_prepared.py
Marca platos preparados/cocinados con flags: ["prepared"].

POR QUÉ:
  Cuando una clienta selecciona "Arroz con pollo asado" como su comida,
  el algoritmo le sugiere atún, merluza, pavo crudo. Clínicamente absurdo.
  El flag "prepared" hace que el algoritmo separe estos platos en su propio
  tier (T3) en vez de mezclarlos con los ingredientes simples crudos.

LÓGICA DE DETECCIÓN:
  Un alimento se marca como "prepared" si cumple AL MENOS UNA:
    A. Su nombre contiene un keyword de plato (lasaña, paella, croquetas, etc.)
    B. Su nombre tiene 2+ ingredientes principales conectados por "con/y/a la"
       Y está en categoría protein/carbs/dairy (no en vegetables/fat puros)

  EXCLUSIONES:
    - flags ya tiene condiment/sweet/hidden → no se toca (esos ya están bien)
    - el nombre contiene patrones de "modo de conservación" (en aceite, al
      natural, en escabeche, lonchas, fileteado) → NO es plato preparado
    - el nombre contiene "salsa de", "pasta de curry", "sazonador" → condimento,
      no plato

POLÍTICA: ADITIVA (nunca quita el flag prepared)
  - Si una corrida marca un alimento como prepared, futuras corridas NO lo
    desmarcan aunque cambien las heurísticas.
  - Si el cliente quiere desmarcar manualmente: editar database.json y borrar
    "prepared" del array flags. La próxima corrida del script no lo va a
    re-marcar si las heurísticas no lo detectan.

Usage:
  python3 scripts/fix_prepared.py
"""

import json
import re
import unicodedata
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
# Keywords de platos preparados (alta confianza)
# ---------------------------------------------------------------------------

DISH_KEYWORDS = [
    # ── Españoles ────────────────────────────────────────────────────────
    "lasaña", "lasagna", "lasagne",
    "paella", "fideua", "fideuá",
    "fabada", "marmitako", "ajoarriero", "ajoblanco",
    "salmorejo", "gazpacho", "gaspacho", "pisto",
    "ropa vieja", "moros y cristianos",
    "pochas", "potaje", "puchero",
    "cocido madrileño", "cocido andaluz", "cocido montañés",
    "callos a la madrileña", "callos madrileña",
    "marmitato",

    # ── Italianos ────────────────────────────────────────────────────────
    "boloñesa", "bolognesa", "boloñes", "bolognes",
    "carbonara",
    "amatriciana",
    "puttanesca",
    "arrabiata", "arrabbiata",
    "siciliana", "piamontesa", "napolitana", "milanesa",
    "alfredo",
    "pesto genoves", "salsa pesto",

    # ── Internacionales ──────────────────────────────────────────────────
    "tikka masala", "tikka",
    "tandoori",
    "kung pao", "kong pao",
    "stroganoff",
    "yakisoba", "ramen",
    "pad thai",
    "chop suey",
    "biryani",

    # ── Métodos de cocción complejos (no ingredientes simples cocidos) ───
    # OJO: NO incluir "estofado", "salteado", "guisado", "frito" sueltos
    # porque atrapan ingredientes simples cocinados ("Conejo estofado",
    # "Vaca estofada"). Solo incluyo combinaciones explícitas de plato:
    "fritada",  # fritada = mezcla de verduras fritas, plato compuesto
    "salsa boloñes", "salsa carbonara",  # salsas listas para servir

    # ── Productos compuestos específicos ─────────────────────────────────
    "croqueta", "croquetas",
    "albondiga", "albondigas", "albóndiga",
    "empanadilla", "empanadillas",
    "empanada de",  # solo cuando es plato (empanada de carne, atún, etc.)
    "tortilla de patata", "tortilla española", "tortilla espanola",
    "tortilla francesa",
    "pizza", "calzone",
    "macarrones a", "macarrones con", "macarrones boloñes",
    "espaguetis a", "espaguetis con", "espagueti a", "espagueti con",
    "ravioles", "ravioli", "tortellini", "tortelloni",
    "gnocchi ", "ñoquis", "noquis",
    "canelones", "canelón", "canelon",
    "risotto",
    "raviole",

    # ── Wraps, bocadillos, plato cerrado ─────────────────────────────────
    "burrito", "fajita ", "wrap ",
    "kebab", "shawarma", "doner", "döner",
    "hamburguesa", "hamburguesas",
    "bocadillo", "sandwich", "sándwich",
    "torrija",
    "rollito",
    "samosa",

    # ── Pasteles/quiche salados ──────────────────────────────────────────
    "quiche",
    "tarta salada",
    "tarta de queso",
    "tarta de espinacas",
    "tarta de verdura",
    "tarta de bacalao",
    "tarta de atun", "tarta de atún",

    # ── Sopas/cremas con ingredientes (ya hay vegetables limpias) ────────
    # No incluyo "crema de" suelto porque hay cremas de verdura puras
    "consome", "consomé",
    "menudo",  # menudo madrileño etc.

    # ── Otros indicadores claros ─────────────────────────────────────────
    "tabbouleh", "tabule",
    "ceviche",
    "tartar de",  # tartar de atún, tartar de salmón
    "carpaccio",
    "bourguignon",
    "schnitzel",
    "moussaka",
    "couscous con", "cuscus con",
    "babaganoush", "baba ganoush",

    # ── BEDCA ya marcó algunos con "frito" — extender ────────────────────
    "empanado, frito",  # ya está pero por consistencia
]


# ---------------------------------------------------------------------------
# Detección de multi-ingrediente (medium confidence)
# ---------------------------------------------------------------------------

# Palabras-base de ingredientes principales
INGREDIENT_BASES = {
    "pollo", "pavo", "ternera", "cerdo", "jamon", "lomo", "bacon", "pancetta",
    "buey", "vaca", "cordero", "conejo", "pato", "perdiz",
    "atun", "salmon", "merluza", "bacalao", "gamba", "gambas", "calamar",
    "pulpo", "sepia", "mejillon", "ostra", "almeja", "berberecho",
    "boqueron", "sardina", "trucha", "rape", "lubina", "dorada", "rodaball",
    "arroz", "pasta", "fideo", "fideos", "cuscus", "quinoa",
    "patata", "boniato", "yuca",
    "huevo", "huevos",
    "lentejas", "garbanzos", "alubias", "judias",
    "tomate", "cebolla", "pimiento", "calabacin", "berenjena", "zanahoria",
    "queso", "leche", "yogur", "nata",
    "espinaca", "espinacas", "esparrago", "esparragos",
    "champinon", "champinones", "seta", "setas",
    "chocolate",
}

# Conectores que sugieren plato compuesto
COMPOUND_CONNECTORS = [
    " con ", " y ", " a la ", " al ", " en su ", " con su ",
    " a los ", " a las ", " estilo ", " tipo ",
]


# ---------------------------------------------------------------------------
# Falsos positivos — protecciones
# ---------------------------------------------------------------------------

# Si el nombre contiene cualquiera de estos patrones, NO es plato preparado
# (son modos de conservación, fiambres, condimentos, etc.)
NOT_PREPARED_PATTERNS = [
    # Conservación / formato comercial
    " en aceite",       # Atún en aceite, sardinas en aceite
    " al natural",      # Atún al natural
    " en agua",         # Atún en agua
    " en escabeche",    # Atún en escabeche
    " en salmuera",     # encurtidos
    " en su jugo",      # frutas en su jugo
    " en almibar", " en almíbar",
    " en polvo",        # leche en polvo
    " enlatad",         # productos en lata
    " en conserva",     # idem
    "lonchas", "loncheado", "fileteado", "rallado",
    " congelad",        # productos congelados crudos
    "aceite oliva",     # productos con AOVE como conservante
    "al ajillo",        # "Al ajillo" es preparación pero suelen ser básicos crudos

    # Descripciones técnicas BEDCA del corte/animal — NO son platos
    " con grasa separable",
    " sin grasa separable",
    " con piel",
    " sin piel",
    " con hueso",
    " sin hueso",
    " con grasa visible",
    " sin grasa visible",

    # NO incluyo "asado", "hervido", "cocido", "crudo", "ecologic" porque
    # esos modificadores de cocción aplican a ingredientes simples (1 ingrediente)
    # y la regla multi-ingrediente requiere 2+, así que ya no se marcan
    # como prepared falsamente. Pero "Arroz con pollo asado" SÍ debe marcarse.

    # Yogures saborizados — son lácteos, no platos
    "yogur",
    "yogures",
    "yoghurt", "yoghourt", "yoghourt",
    "kefir", "kéfir",
    "skyr",
    "cuajada",

    # Lácteos / bebidas vegetales — productos, no platos
    "leche de ",            # "Leche de arroz", "Leche de almendra"
    "bebida de ",           # bebidas vegetales
    "queso fresco",         # quesos frescos básicos (con/sin descriptores)
    "queso de ",            # "Queso de Castilla-La Mancha, oveja..."
    "queso untar",          # queso para untar — borderline pero conservador

    # Yogures/postres con frutas listadas → lácteo, no plato
    " con fresa", " con frutas", " con frutos", " con cereal",
    " con muesli", " con avena", " con miel", " con vainilla",
    " con melocoton", " con melocotón",
    " con ciruela", " con frambuesa", " con grosella",

    # Pasta cruda — es ingrediente seco, no plato
    "pasta alimenticia",
    "pasta cruda",
    "pasta italiana",
    "pasta seca",
    " al huevo",   # "Pappardelle al huevo" es tipo de pasta seca

    # Leche condensada/evaporada/UHT — productos lácteos
    " condensad",
    " evaporad",
    " uht",

    # Carnes BEDCA con enumeración descriptiva técnica
    "partes grasa y magra",
    "capa blanca",
    "magra y semigrasa",
]

# Keywords que indican condimento/salsa, no plato
CONDIMENT_INDICATORS = [
    "pasta de curry", "salsa de", "salsa para",
    "sazonador", "especia", "condimento",
    "polvo de", "extracto de", "esencia de",
    "pasta de tomate", "pasta de aceitunas",
    "vinagreta",
]

# Keywords que indican el alimento es solo el INGREDIENTE puro cocido,
# no un plato preparado complejo
SINGLE_BASIC_PATTERNS = [
    # "Pollo, frito" o "Pollo frito" SUELTO sin más ingredientes →
    # es un ingrediente cocido, no un plato. Si NO tiene otros conectores
    # ni ingredientes adicionales en el nombre, lo dejamos sin prepared.
    # Esto se valida en lógica abajo, no en patrón
]


# ---------------------------------------------------------------------------
# Lógica principal
# ---------------------------------------------------------------------------

def has_protected_flag(food: dict) -> bool:
    """Tiene flag que ya excluye al alimento del algoritmo (no tocar)."""
    flags = set(food.get("flags") or [])
    return bool(flags & {"condiment", "sweet"})


def has_not_prepared_pattern(name_n: str) -> bool:
    """True si el nombre tiene un patrón que indica que NO es plato preparado."""
    return any(p in name_n for p in NOT_PREPARED_PATTERNS)


def has_condiment_indicator(name_n: str) -> bool:
    """True si el nombre indica condimento/salsa, no plato."""
    return any(p in name_n for p in CONDIMENT_INDICATORS)


def has_dish_keyword(name_n: str) -> str | None:
    """Retorna el primer keyword de plato encontrado en el nombre, o None."""
    for kw in DISH_KEYWORDS:
        if kw in name_n:
            return kw
    return None


def count_ingredients(name_n: str) -> int:
    """Cuenta cuántos ingredientes-base distintos aparecen en el nombre."""
    found = set()
    for ing in INGREDIENT_BASES:
        if ing in name_n:
            found.add(ing)
    return len(found)


def has_compound_connector(name_n: str) -> bool:
    """True si el nombre tiene un conector que sugiere plato compuesto."""
    return any(c in name_n for c in COMPOUND_CONNECTORS)


def is_prepared_dish(food: dict) -> tuple[bool, str]:
    """
    Decide si un alimento es plato preparado.
    Retorna (es_preparado, motivo).
    """
    # Ya tiene prepared → preservarlo
    flags = food.get("flags") or []
    if "prepared" in flags:
        return True, "ya tenía flag prepared"

    # Tiene flag protegido → no tocar
    if has_protected_flag(food):
        return False, "tiene flag condiment/sweet"

    name_n = norm(food.get("name", ""))
    name_raw = (food.get("name") or "")
    if not name_n:
        return False, "nombre vacío"

    # Modos de conservación → NO es plato preparado
    if has_not_prepared_pattern(name_n):
        return False, "patrón de conservación"

    # Es condimento/salsa, no plato
    if has_condiment_indicator(name_n):
        return False, "condimento/salsa"

    # ── Regla A: keyword de plato directo (alta confianza) ──────────────
    kw = has_dish_keyword(name_n)
    if kw:
        return True, f"keyword:{kw}"

    # ── Regla B: multi-ingrediente con conector ─────────────────────────
    # Solo en categorías donde tenga sentido (proteín/carbs/dairy)
    # Y solo si el nombre no tiene "/" o " o " (alternativas técnicas
    # como "Vaca/buey" cuentan 2 ingredientes pero son uno solo)
    if "/" in name_raw or " o " in name_n:
        return False, "alternativa técnica (vaca/buey, etc)"

    if food.get("category") in ("protein", "carbs", "dairy"):
        ing_count = count_ingredients(name_n)
        if ing_count >= 2 and has_compound_connector(name_n):
            return True, f"multi-ingrediente ({ing_count})"

    return False, "no detectado"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print(f"Leyendo {DB_PATH}...")
    with open(DB_PATH, encoding="utf-8") as f:
        data = json.load(f)

    foods = data["foods"]
    total = len(foods)

    previously_prepared = sum(
        1 for f in foods if "prepared" in (f.get("flags") or [])
    )
    print(f"  → Alimentos con flag prepared antes: {previously_prepared}")

    newly_marked = []
    by_reason: dict[str, int] = {}

    for food in foods:
        is_prep, reason = is_prepared_dish(food)
        if not is_prep:
            continue

        flags = food.get("flags") or []
        if "prepared" in flags:
            continue  # ya estaba marcado, no contarlo como nuevo

        food["flags"] = flags + ["prepared"]
        newly_marked.append((food, reason))
        by_reason[reason.split(":")[0]] = by_reason.get(reason.split(":")[0], 0) + 1

    # Guardar
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # Reporte
    total_prepared = sum(1 for f in foods if "prepared" in (f.get("flags") or []))
    print()
    print("=" * 70)
    print(f"DETECCIÓN DE PLATOS PREPARADOS")
    print("=" * 70)
    print(f"Marcados nuevos: {len(newly_marked)}")
    print(f"Total con prepared ahora: {total_prepared} (antes: {previously_prepared})")
    print()
    print("Por motivo de detección:")
    for reason, count in sorted(by_reason.items(), key=lambda x: -x[1]):
        print(f"  {reason:25} {count}")
    print()

    print("=" * 70)
    print("EJEMPLOS DE NUEVOS MARCADOS (primeros 30):")
    print("=" * 70)
    for food, reason in newly_marked[:30]:
        cat = food.get("category", "?")
        src = food.get("source", "?")
        print(f"  [{src:15}] cat:{cat:10} ({reason:30}) | {food['name']}")

    if len(newly_marked) > 30:
        print(f"  ... y {len(newly_marked) - 30} más")

    print()
    print(f"Total alimentos en BD: {total}")
    print("database.json guardado.")


if __name__ == "__main__":
    main()
