#!/usr/bin/env python3
"""
scripts/dedupe_basicos.py
Marca alimentos básicos duplicados con flags: ["hidden"] para que no aparezcan
como intercambios.

REGLA DE ORO:
  - Idempotente: correr el script 1 o 100 veces produce el mismo resultado
  - No-destructivo: nunca borra alimentos, solo agrega/quita el flag "hidden"
  - Conservador: si un alimento no está en la lista de básicos, no se toca
  - Reversible: el cliente puede sacar manualmente el flag y vuelve a aparecer

LÓGICA:
  1. Resetear todos los flags "hidden" existentes (re-evaluar desde cero)
  2. Para cada patrón de "alimento básico":
       - Encontrar todos los alimentos que coinciden con los keywords
       - Excluir los que tienen keywords de "marca importa"
       - Excluir los que tienen flags: condiment, prepared, sweet
       - Agrupar por similitud nutricional (±15% en cal, prot, carbs, fat)
       - En cada cluster con más de 1 miembro:
           * Elegir 1 canónico (BEDCA > OFF completo > Supermercado, nombre corto)
           * Marcar los demás con flag "hidden"

Usage:
  python3 scripts/dedupe_basicos.py
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
    """Minúsculas, sin acentos, sin caracteres especiales."""
    s = (s or "").lower().strip()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# ---------------------------------------------------------------------------
# Listas configurables — extender acá cuando aparezcan nuevos productos
# ---------------------------------------------------------------------------

# BÁSICOS — alimentos donde la marca NO importa, se deduplica por similitud nutricional
# Cada entrada: (etiqueta, keywords_required, keywords_excluded, categorías_válidas)
#   - keywords_required: TODOS deben aparecer en el nombre normalizado
#   - keywords_excluded: NINGUNO debe aparecer (diferencia variantes)
#   - categorías_válidas: lista de categorías donde aplica (None = cualquiera)
BASICOS = [
    # ── Carnes ──────────────────────────────────────────────────────────────
    ("pollo pechuga",       ["pollo", "pechuga"], ["empanad", "rebozad", "nugget", "salchich"], ["protein"]),
    ("pollo muslo",         ["pollo", "muslo"],   ["empanad", "rebozad"],                       ["protein"]),
    ("pollo entero",        ["pollo", "entero"],  ["empanad"],                                  ["protein"]),
    ("pavo pechuga",        ["pavo", "pechuga"],  ["empanad", "rebozad"],                       ["protein"]),
    # Ternera magra: excluir vísceras (riñón, hígado, lengua, corazón, callos)
    # y embutidos/preparados
    ("ternera magra",       ["ternera"],          ["embut", "salchich", "hambur", "albondig",
                                                    "riñon", "rinon", "higado", "lengua",
                                                    "corazon", "callos", "sesos", "mollej",
                                                    "carrillera", "rabo"],                       ["protein"]),
    ("cerdo solomillo",     ["cerdo", "solomillo"], [],                                         ["protein"]),
    ("cerdo lomo",          ["cerdo", "lomo"],    ["embuchad", "embut"],                        ["protein"]),

    # ── Pescados ────────────────────────────────────────────────────────────
    # Diferenciamos atún natural / en aceite / escabeche por keyword excluido
    ("atun natural",        ["atun"],             ["aceite", "escabeche", "ventresca", "ensalada", "pat"], ["protein"]),
    ("atun en aceite",      ["atun", "aceite"],   ["ensalada", "pat"],                          ["protein"]),
    ("atun escabeche",      ["atun", "escabeche"], [],                                          ["protein"]),
    ("merluza",             ["merluza"],          ["rebozad", "empanad", "varita", "peskito", "surfer"], ["protein"]),
    ("salmon fresco",       ["salmon"],           ["ahumad", "marinad", "cocid"],               ["protein"]),
    ("bacalao",             ["bacalao"],          ["rebozad", "empanad", "buñuel"],             ["protein"]),
    ("sardina",             ["sardina"],          ["aceite", "tomate", "escabeche"],            ["protein"]),

    # ── Legumbres ───────────────────────────────────────────────────────────
    # Las cocidas en bote son muy similares entre marcas
    ("lentejas cocidas",    ["lentejas", "cocida"], ["jardinera", "verdura", "espelta", "quinoa", "ternera", "chorizo"], ["protein", "carbs"]),
    ("garbanzos cocidos",   ["garbanzos"],        ["espinaca", "ternera", "verdura", "harina", "frito", "tostad"], ["protein", "carbs"]),
    ("alubias cocidas",     ["alubias"],          ["chorizo", "carne", "verdura"],              ["protein", "carbs"]),
    ("judias blancas",      ["judias", "blanca"], ["verdura", "carne"],                         ["protein", "carbs"]),

    # ── Cereales / féculas ──────────────────────────────────────────────────
    # Arroz: diferenciamos crudo vs precocido vs cocinado
    ("arroz blanco crudo",  ["arroz", "blanco"],  ["precocid", "pollo", "verdura", "ecologic"], ["carbs"]),
    ("arroz integral crudo", ["arroz", "integral"], ["precocid", "verdura", "pollo"],           ["carbs"]),
    ("pasta cruda",         ["pasta"],            ["pollo", "verdura", "boloñes", "carbonar", "salsa", "huevo"], ["carbs"]),
    ("patata cruda",        ["patata", "cruda"],  [],                                           ["carbs", "vegetables"]),
    ("patata hervida",      ["patata", "hervid"], [],                                           ["carbs", "vegetables"]),
    ("quinoa",              ["quinoa"],           ["lentejas", "verdura", "salteado"],          ["carbs"]),

    # ── Huevos ──────────────────────────────────────────────────────────────
    ("huevo entero crudo",  ["huevo", "gallina"], ["pasta", "claras", "albumin", "fideos"],     ["protein"]),
    ("clara de huevo",      ["clara", "huevo"],   [],                                           ["protein"]),

    # ── Aceites puros ───────────────────────────────────────────────────────
    # Solo el aceite puro, no productos CON aceite
    ("aceite oliva virgen", ["aceite", "oliva"],  ["tomate", "ajos", "ajo", "verdura", "pisto", "fritada", "habit", "crema", "salsa"], ["fat"]),
    ("aceite girasol",      ["aceite", "girasol"], ["tomate", "verdura", "frito"],              ["fat"]),

    # ── Lácteos básicos (NO proteicos) ──────────────────────────────────────
    ("leche entera",        ["leche", "entera"],  ["condensad", "evaporad", "polvo"],           ["dairy"]),
    ("leche desnatada",     ["leche", "desnatad"], ["condensad", "polvo"],                      ["dairy"]),
    ("leche semidesnatada", ["leche", "semidesnatad"], [],                                      ["dairy"]),

    # ── Frutas básicas ──────────────────────────────────────────────────────
    # IMPORTANTE: hay que ser muy estricto con exclusiones para no agarrar
    # yogures, postres, papillas o mezclas que mencionan la fruta en el nombre.
]

# Exclusiones genéricas para frutas — si aparece cualquiera de estos términos,
# el alimento NO es la fruta básica (es un yogur, postre, mezcla, etc.)
_FRUIT_NOT_BASIC = [
    "zumo", "nectar", "smoothie", "batido", "compota", "tarta", "papilla",
    "tarrito", "petit", "yogur", "yopro", "bifidus", "biactive", "kefir",
    "skyr", "queso", "leche", "natur", "fresh", "fruit cie", "fruit & cie",
    "vital", "snack", "barrita", "merm", "confit", "almibar", "pure",
    "salsa", "dolce", "drink", "bebida", "lacteo",
]

BASICOS += [
    ("manzana",  ["manzana"],
     _FRUIT_NOT_BASIC + [
         "platano", "pera", "uva", "fresa", "mango", "maracuya",
         "jengibre", "naranja", "kiwi", "piña", "pina", "cereza",
         "fruta variada", "multifruta",
     ], ["carbs"]),
    ("platano",  ["platano"],
     _FRUIT_NOT_BASIC + [
         "manzana", "fresa", "mango", "pera", "mandarina", "kiwi",
         "fruta variada", "multifruta",
     ], ["carbs"]),
    ("naranja",  ["naranja"],
     _FRUIT_NOT_BASIC + [
         "mandarina", "uva", "mango", "limon", "fruta variada",
         "multifruta", "magnesio",
     ], ["carbs"]),
    ("pera",     ["pera"],
     _FRUIT_NOT_BASIC + [
         "manzana", "platano", "fresa", "mango", "tomate",
         "fruta variada", "multifruta",
     ], ["carbs"]),
]

# MARCA IMPORTA — nunca deduplicar, los macros varían realmente entre marcas
# Si el nombre normalizado contiene CUALQUIERA de estos keywords → no se toca
MARCA_IMPORTA = [
    "skyr", "yopro", "yogur proteico", "yogures proteicos",
    "queso fresco batido", "queso cottage", "quark",
    "hummus",
    "fiambre", "lonchas", "loncheado",
    "bebida de almendra", "bebida de avena", "bebida de soja", "bebida de arroz",
    "bebida vegetal", "bebida de coco", "bebida de espelta",
    "pan", "wrap", "tortilla mexicana", "tortilla wrap",
    "barrita", "barritas",
    "postre proteico", "batido proteico", "shake proteico",
    "proteina plus", "alta en proteina",
    "preparado proteico", "high protein",
    "galleta proteica",
]

# PRIORIDAD DE FUENTES — para elegir el alimento canónico de un cluster
SOURCE_PRIORITY = {
    "BEDCA": 100,
    "OpenFoodFacts": 50,
    "Mercadona": 30, "Carrefour": 30, "Lidl": 30,
    "Dia": 30, "Eroski": 30, "Alcampo": 30, "Aldi": 30,
    "El Corte Inglés": 30, "Consum": 30, "Hipercor": 30,
    "FatSecret": 20,
}

# ---------------------------------------------------------------------------
# Lógica
# ---------------------------------------------------------------------------

CRITICAL_FLAGS = {"condiment", "prepared", "sweet"}


def matches_basic(food: dict, required: list, excluded: list, categories: list) -> bool:
    """True si el alimento coincide con un patrón de básico."""
    if categories and food.get("category") not in categories:
        return False
    name_n = norm(food.get("name", ""))
    if not all(kw in name_n for kw in required):
        return False
    if any(kw in name_n for kw in excluded):
        return False
    return True


def is_marca_importa(food: dict) -> bool:
    """True si el alimento es de los productos donde la marca importa."""
    name_n = norm(food.get("name", ""))
    return any(kw in name_n for kw in MARCA_IMPORTA)


def has_critical_flag(food: dict) -> bool:
    """True si el alimento tiene flag que ya lo excluye del algoritmo."""
    flags = set(food.get("flags") or [])
    return bool(flags & CRITICAL_FLAGS)


def macros_similar(a: dict, b: dict, tol: float = 0.15) -> bool:
    """True si dos alimentos están dentro del ±15% en cal, prot, carbs, fat."""
    for key in ("calories", "protein", "carbs", "fat"):
        va = a.get(key) or 0
        vb = b.get(key) or 0
        if va == 0 and vb == 0:
            continue
        denom = max(abs(va), abs(vb), 1.0)
        if abs(va - vb) / denom > tol:
            return False
    return True


def cluster_by_macros(foods: list) -> list:
    """Agrupa alimentos en clusters de macros similares (±15%)."""
    clusters = []
    used = set()
    for i, a in enumerate(foods):
        if i in used:
            continue
        cluster = [a]
        used.add(i)
        for j, b in enumerate(foods):
            if j in used or j == i:
                continue
            if macros_similar(a, b):
                cluster.append(b)
                used.add(j)
        clusters.append(cluster)
    return clusters


def macros_completos(food: dict) -> bool:
    """True si tiene los 4 macros con valores válidos (no None ni 0 todos)."""
    macs = [food.get(k) for k in ("calories", "protein", "carbs", "fat")]
    if any(m is None for m in macs):
        return False
    # OK aunque algún macro sea 0 mientras tenga calorías
    return (food.get("calories") or 0) > 0


def pick_canonical(cluster: list) -> dict:
    """Elige el alimento canónico de un cluster por prioridad de fuente."""
    def score(food):
        src = food.get("source", "") or ""
        s = SOURCE_PRIORITY.get(src, 0)
        # OpenFoodFacts solo es prioritario si tiene macros completos
        if src == "OpenFoodFacts" and not macros_completos(food):
            s = 10
        # Preferir nombres más cortos (más limpios)
        s -= len(food.get("name", "")) * 0.1
        # Preferir el que NO tiene marca específica
        if not food.get("brand"):
            s += 5
        return s
    return max(cluster, key=score)


def reset_hidden_flags(foods: list) -> int:
    """Quita el flag 'hidden' de todos los alimentos. Retorna cuántos tenía."""
    count = 0
    for food in foods:
        flags = food.get("flags") or []
        if "hidden" in flags:
            food["flags"] = [f for f in flags if f != "hidden"]
            count += 1
    return count


def add_hidden_flag(food: dict) -> None:
    """Agrega 'hidden' a flags si no está. Preserva los demás flags."""
    flags = food.get("flags") or []
    if "hidden" not in flags:
        food["flags"] = flags + ["hidden"]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print(f"Leyendo {DB_PATH}...")
    with open(DB_PATH, encoding="utf-8") as f:
        data = json.load(f)

    foods = data["foods"]
    total = len(foods)

    # Paso 1: resetear todos los flags hidden (idempotencia)
    previously_hidden = reset_hidden_flags(foods)
    print(f"  → Reseteados {previously_hidden} flags 'hidden' existentes")

    # Paso 2: para cada patrón de básico, encontrar duplicados y marcar
    # Usamos un set para contar correctamente cuando un alimento matchea
    # varios patrones (ej: "Atún claro" puede entrar en "atun natural" y
    # "atun en aceite" — solo se cuenta una vez).
    summary = []
    hidden_ids: set[str] = set()

    for label, required, excluded, cats in BASICOS:
        # Encontrar candidatos
        matches = [
            f for f in foods
            if matches_basic(f, required, excluded, cats)
            and not has_critical_flag(f)
            and not is_marca_importa(f)
        ]
        if len(matches) < 2:
            continue

        # Cluster por macros
        clusters = cluster_by_macros(matches)
        clusters_with_dupes = [c for c in clusters if len(c) > 1]
        if not clusters_with_dupes:
            continue

        hidden_in_label = 0
        details = []
        for cluster in clusters_with_dupes:
            canonical = pick_canonical(cluster)
            for food in cluster:
                if food["id"] != canonical["id"]:
                    add_hidden_flag(food)
                    hidden_ids.add(food["id"])
                    hidden_in_label += 1
            details.append({
                "canonical": canonical,
                "hidden": [f for f in cluster if f["id"] != canonical["id"]],
            })

        summary.append((label, hidden_in_label, details))

    # Paso 3: guardar
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # Paso 4: resumen
    total_hidden = len(hidden_ids)
    print()
    print("=" * 70)
    print(f"DEDUPLICACIÓN COMPLETA: {total_hidden} alimentos únicos marcados como 'hidden'")
    print("=" * 70)
    for label, count, details in summary:
        print(f"\n  ▶ {label}: {count} duplicados ocultados")
        for d in details[:3]:  # mostrar solo primeros 3 clusters por label
            c = d["canonical"]
            print(f"      ✓ canónico: [{c.get('source','?')}] {c['name']}")
            for h in d["hidden"][:5]:
                print(f"        ✗ oculto:   [{h.get('source','?')}] {h['name']}")
            if len(d["hidden"]) > 5:
                print(f"        ... y {len(d['hidden']) - 5} más")

    print()
    print(f"Total alimentos en BD: {total}")
    print(f"Total con flag 'hidden': {total_hidden}")
    print(f"Visibles para el algoritmo: {total - total_hidden}")
    print()
    print("database.json guardado.")


if __name__ == "__main__":
    main()
