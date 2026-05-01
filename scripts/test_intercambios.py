#!/usr/bin/env python3
"""
scripts/test_intercambios.py
Validación automática de casos clínicos reales.

Replica EN PYTHON la lógica de js/algorithm.js (filter por categoría +
exclusión de flags + clasificación por tier T1/T2/T3) y verifica que cada
caso de uso definido abajo cumpla las expectativas clínicas.

Cuándo correrlo:
  - Después de agregar nuevos alimentos a database.json
  - Después de modificar fix_categories.py / fix_sweets.py / fix_prepared.py
  - Después de modificar dedupe_basicos.py
  - Antes de hacer un release o push importante

Uso:
  python3 scripts/test_intercambios.py

Si todos los tests pasan, sale con código 0.
Si alguno falla, imprime el detalle y sale con código 1.
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "database.json"


# ---------------------------------------------------------------------------
# Replicación de la lógica de algorithm.js
# ---------------------------------------------------------------------------

STOP_WORDS = {
    "de", "la", "el", "los", "las", "del", "al", "en", "y", "a", "e", "o",
    "un", "una", "con", "sin", "por", "para",
}


def norm(s: str) -> str:
    s = (s or "").lower().strip()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def tokenize(name: str) -> list:
    return [t for t in norm(name).split() if t and t not in STOP_WORDS]


def get_tier(candidate: dict, original: dict) -> int:
    """Replica js/algorithm.js getFoodTier."""
    if "prepared" in (candidate.get("flags") or []):
        return 3
    base_tokens = tokenize(original.get("name", ""))
    base_word = base_tokens[0] if base_tokens else ""
    if base_word and base_word in norm(candidate.get("name", "")):
        return 1
    return 2


def find_food(foods: list, name: str) -> dict:
    """Busca un alimento por nombre exacto (case-insensitive)."""
    nl = name.lower()
    for f in foods:
        if (f.get("name") or "").lower() == nl:
            return f
    # fallback: substring match
    for f in foods:
        if nl in (f.get("name") or "").lower():
            return f
    return None


def calculate_alternatives(original: dict, foods: list) -> dict:
    """Replica js/algorithm.js calculateAlternatives — devuelve {t1, t2, t3}."""
    candidates = [
        f for f in foods
        if f.get("id") != original.get("id")
        and f.get("category") == original.get("category")
        and "condiment" not in (f.get("flags") or [])
        and "sweet" not in (f.get("flags") or [])
        and "hidden" not in (f.get("flags") or [])
    ]

    t1, t2, t3 = [], [], []
    for c in candidates:
        tier = get_tier(c, original)
        if tier == 1:
            t1.append(c)
        elif tier == 2:
            t2.append(c)
        else:
            t3.append(c)

    return {"t1": t1, "t2": t2, "t3": t3, "all": candidates}


# ---------------------------------------------------------------------------
# Casos clínicos a validar
# ---------------------------------------------------------------------------

# Cada caso especifica:
#   query_food: nombre del alimento que la usuaria selecciona del menú
#   should_appear: lista de keywords — al menos UNO debe aparecer en T2 (intercambios)
#   should_NOT_appear: lista de keywords — NINGUNO debe aparecer en T2
#   expected_tier_count: rangos esperados de cantidad de candidatos por tier (mín, máx)

TEST_CASES = [
    {
        "label": "Pollo pechuga → debe sugerir otras proteínas, no condimentos",
        "query": "Pollo, pechuga, con piel, crudo",
        "t2_should_include_any": ["pavo", "salmon", "merluza", "ternera", "cerdo", "atun", "perdiz"],
        # Solo nombres puros de condimentos (no productos "a la pimienta")
        "t2_should_NOT_include_any": ["azafran molido", "tomillo seco", "oregano molido"],
        "t2_min": 50,
    },
    {
        "label": "Espárrago verde → debe sugerir otras verduras, no carnes",
        "query": "Espárrago, verde",
        "t2_should_include_any": ["brocoli", "brécol", "espinaca", "calabacin", "coliflor", "alcachofa"],
        "t2_should_NOT_include_any": ["pollo", "pavo", "ternera", "atun"],
        "t2_min": 10,
    },
    {
        "label": "Arroz blanco → debe sugerir otros carbos, no golosinas ni dulces",
        "query": "Arroz",
        "t2_should_include_any": ["pasta", "patata", "quinoa", "cuscus", "boniato", "avena"],
        "t2_should_NOT_include_any": ["mousy", "krokodil", "osi fruit", "gominola", "caramelo"],
        "t2_min": 30,
    },
    {
        "label": "Atún crudo → debe sugerir otros pescados/proteínas, no productos azucarados",
        "query": "Atún, crudo",
        "t2_should_include_any": ["salmon", "merluza", "bacalao", "pollo", "pavo"],
        "t2_should_NOT_include_any": ["mermelada", "azucar", "sirope"],
        "t2_min": 50,
    },
    {
        "label": "Brócoli hervido → debe sugerir otras verduras",
        "query": "Brécol, hervido",
        "t2_should_include_any": ["coliflor", "espinaca", "judia", "calabacin", "alcachofa"],
        "t2_should_NOT_include_any": ["pollo", "atun", "queso", "leche"],
        "t2_min": 10,
    },
    {
        "label": "Aguacate → debe sugerir otras grasas, no verduras",
        "query": "Aguacate",
        "t2_should_include_any": ["aceite", "almendra", "nuez", "aceituna", "mantequilla"],
        "t2_should_NOT_include_any": ["pollo crud", "lechuga", "atun crud"],
        "t2_min": 20,
    },
    {
        "label": "Lentejas cocidas → debe sugerir otras legumbres / fuentes proteicas",
        "query": "Lenteja, hervida",  # nombre real en BEDCA
        "t2_should_include_any": ["garbanzo", "alubia", "pollo", "atun", "huevo"],
        "t2_should_NOT_include_any": ["mantequilla", "aceite oliva virgen extra"],
        "t2_min": 30,
    },
    {
        "label": "Yogur natural → debe sugerir otros lácteos, no panes/proteínas crudas",
        "query": "Yogur natural",
        "t2_should_include_any": ["yogur", "leche", "kefir", "skyr", "queso fresco"],
        # Excluir solo productos claramente NO lácteos
        "t2_should_NOT_include_any": ["pollo crud", "atun crudo", "lechuga", "aceite oliva virgen"],
        "t2_min": 20,
    },
    {
        "label": "Plato preparado 'Arroz con pollo' → debe ir a T3, no a T2 con crudos",
        "query": "Arroz con pollo",
        "expected_in_t3": True,  # El propio plato debe estar en categoría protein con flag prepared
        "t3_min": 30,  # Otros platos preparados disponibles
    },
]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def keyword_matches_any(foods: list, keywords: list) -> list:
    """Retorna lista de (food, kw) donde el food contiene alguno de los keywords en el nombre."""
    out = []
    for f in foods:
        nm = norm(f.get("name", ""))
        for kw in keywords:
            if norm(kw) in nm:
                out.append((f, kw))
                break
    return out


def run_case(foods: list, case: dict) -> dict:
    """Ejecuta un caso. Retorna {passed, errors, warnings, summary}."""
    errors = []
    warnings = []

    # Buscar el alimento
    original = find_food(foods, case["query"])
    if not original:
        return {
            "passed": False,
            "errors": [f"Alimento '{case['query']}' no encontrado en database.json"],
            "warnings": [],
            "summary": {},
        }

    # Calcular intercambios
    result = calculate_alternatives(original, foods)
    t1, t2, t3 = result["t1"], result["t2"], result["t3"]

    summary = {
        "original": original.get("name"),
        "category": original.get("category"),
        "flags": original.get("flags"),
        "t1_count": len(t1),
        "t2_count": len(t2),
        "t3_count": len(t3),
    }

    # Verificación: debe aparecer al menos uno de los esperados en T2
    if "t2_should_include_any" in case:
        kws = case["t2_should_include_any"]
        matches = keyword_matches_any(t2, kws)
        if not matches:
            errors.append(
                f"Esperaba al menos uno de {kws} en T2, pero NO apareció ninguno"
            )
        summary["t2_includes_match"] = matches[0][1] if matches else None

    # Verificación: NO debe aparecer ninguno de los excluidos en T2
    if "t2_should_NOT_include_any" in case:
        kws = case["t2_should_NOT_include_any"]
        bad_matches = keyword_matches_any(t2, kws)
        if bad_matches:
            food, kw = bad_matches[0]
            errors.append(
                f"NO debería aparecer '{kw}' en T2, pero apareció: {food.get('name')!r}"
            )

    # Verificación: cantidad mínima de candidatos en T2
    if "t2_min" in case and len(t2) < case["t2_min"]:
        warnings.append(
            f"T2 tiene {len(t2)} candidatos, esperaba mínimo {case['t2_min']}"
        )

    # Verificación: el alimento original debería tener flag prepared
    if case.get("expected_in_t3"):
        flags = original.get("flags") or []
        if "prepared" not in flags:
            errors.append(
                f"'{original.get('name')}' debería tener flag 'prepared' (es un plato compuesto)"
            )

    if "t3_min" in case and len(t3) < case["t3_min"]:
        warnings.append(
            f"T3 tiene {len(t3)} preparados, esperaba mínimo {case['t3_min']}"
        )

    return {
        "passed": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "summary": summary,
    }


def main() -> int:
    print(f"Cargando {DB_PATH}...")
    with open(DB_PATH, encoding="utf-8") as f:
        data = json.load(f)
    foods = data["foods"]
    print(f"  → {len(foods)} alimentos cargados")
    print()

    print("=" * 72)
    print("VALIDACIÓN DE CASOS CLÍNICOS REALES")
    print("=" * 72)

    passed = 0
    failed = 0
    warnings_total = 0

    for i, case in enumerate(TEST_CASES, 1):
        print(f"\n[{i}/{len(TEST_CASES)}] {case['label']}")
        result = run_case(foods, case)
        summary = result["summary"]

        if summary:
            print(
                f"  → Original: {summary.get('original')!r} "
                f"(cat:{summary.get('category')}, flags:{summary.get('flags')})"
            )
            print(
                f"  → T1:{summary.get('t1_count')} "
                f"T2:{summary.get('t2_count')} "
                f"T3:{summary.get('t3_count')}"
            )

        if result["passed"]:
            print(f"  ✅ PASS")
            passed += 1
        else:
            print(f"  ❌ FAIL")
            for err in result["errors"]:
                print(f"     ERROR: {err}")
            failed += 1

        for warn in result["warnings"]:
            print(f"     ⚠️  {warn}")
            warnings_total += 1

    # Resumen final
    print()
    print("=" * 72)
    print("RESUMEN")
    print("=" * 72)
    print(f"  Pasados:  {passed}/{len(TEST_CASES)}")
    print(f"  Fallados: {failed}/{len(TEST_CASES)}")
    print(f"  Warnings: {warnings_total}")
    print()

    if failed == 0:
        print("✅ Todos los casos pasaron — la app está cumpliendo el brief clínico")
        return 0
    else:
        print("❌ Hay casos que fallaron — revisar el detalle arriba")
        return 1


if __name__ == "__main__":
    sys.exit(main())
