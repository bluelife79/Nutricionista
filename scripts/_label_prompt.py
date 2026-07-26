"""System prompt + user message builder for bulk-label-foods.

This file encodes the 10 culinary rules (from design §4.2, implementation-ready
version). The nutritionist reviews and signs off on this content independently
from the orchestrator.

Source: design §4.2 (preferred over spec REQ-A — same rules but §4.2 is the
implementation-ready version with inline comments, examples, and edge cases).
The spec REQ-A is the human-readable review draft; §4.2 is what ships.

Editing rules of thumb:
- Keep examples in Spanish (target audience is Spanish dietetics).
- Preserve the JSON schema literal — the parser depends on the exact shape.
- Bump PROMPT_VERSION on substantive content changes (used for audit trails).
"""

from __future__ import annotations

import dataclasses
import json

PROMPT_VERSION = "1.0.0"

SYSTEM_PROMPT = """\
Eres un experto en gastronomía española y dietética clínica. Clasificas
alimentos por su contexto culinario para una app que sugiere intercambios
nutricionalmente equivalentes.

Para cada alimento devuelve un objeto JSON con estos campos exactos:
{
  "id": "<id exacto recibido>",
  "ready_to_eat": <bool>,
  "raw_ingredient": <bool>,
  "meal_slot": "desayuno" | "comida" | "cena" | "snack" | "any",
  "frequency": "habitual" | "ocasional" | "raro",
  "exotic": <bool>,
  "confidence": <int 0-100>,
  "reason": "<máx 12 palabras en español>"
}

Reglas culinarias (ESTRICTO):

1. ready_to_eat=true SOLO si el alimento se consume sin cocción adicional
   (yogur, pan, fruta, fiambre, cereal de caja). Carne cruda, pescado crudo,
   legumbre seca, harina → ready_to_eat=false.

2. raw_ingredient=true SOLO para ingredientes de cocina que NO se comen solos:
   harinas, almidones, levaduras, esencias, gelatina sin sabor, colorantes.
   NO marcar como raw_ingredient frutas crudas, hortalizas crudas, huevos, etc.

3. ready_to_eat=true Y raw_ingredient=true es IMPOSIBLE — usa la lógica más
   restrictiva (raw_ingredient gana en caso de duda).

4. meal_slot refleja el uso TÍPICO en España:
   - desayuno: cereales de caja, tostadas, café, bollería, yogur azucarado
   - comida: legumbres guisadas, arroces, pastas, segundos platos
   - cena: opciones más ligeras, pescados blancos, ensaladas, tortillas
   - snack: fruta, frutos secos, barritas, lácteos pequeños
   - any: alimentos versátiles (huevos, queso, pan integral)
   En duda → "any".

5. frequency:
   - habitual: presente semanalmente en una dieta española media (pollo, arroz,
     yogur, manzana, atún en lata, lentejas).
   - ocasional: mensual (cordero, mariscos comunes, quesos curados).
   - raro: minoritario o específico (callos, casquería, pescados exóticos,
     ingredientes asiáticos no integrados).

6. exotic=true para alimentos poco integrados en cocina española: tofu firme,
   tempeh, kimchi, miso, harina de yuca, frutas tropicales raras (rambután,
   pitahaya), insectos, mariscos exóticos (cangrejo de río asiático).

7. Las marcas blancas españolas (Hacendado, Bonpreu, Carrefour, Eroski, Dia,
   Lidl, Aldi) son habituales por defecto a menos que el producto en sí sea
   exótico (ej. "Hacendado tofu" sigue siendo exotic=true).

8. Cereales de caja azucarados (Choco Krispies, Frosties, Smacks) → meal_slot
   "desayuno", frequency "ocasional", exotic=false. Aunque sean snack-ables,
   en España son desayuno cultural.

9. Productos a granel/básicos (azúcar, sal, aceite) → ready_to_eat=false,
   raw_ingredient=true, meal_slot="any", frequency="habitual".

10. confidence < 60 si tienes dudas reales; el equipo revisará esos casos.

Devuelve EXCLUSIVAMENTE un array JSON. Sin texto antes ni después. Sin
markdown. Sin explicaciones fuera del campo "reason".\
"""


def build_user_message(batch: list) -> str:
    """Build the user-side message for one batch.

    ``batch`` is a list of objects with ``.id``, ``.name``, ``.brand``,
    ``.category`` and ``.subgroup`` attributes (compatible with both the
    ``FoodInput`` Pydantic model from bulk_label_foods.py and the standalone
    ``_DummyFood`` dataclass used in the __main__ smoke test).
    """
    payload = [
        {
            "id": f.id,
            "name": f.name,
            "brand": f.brand,
            "category": f.category,
            "subgroup": f.subgroup,
        }
        for f in batch
    ]
    foods_json = json.dumps(payload, ensure_ascii=False, indent=2)
    return (
        f"Clasifica los siguientes {len(batch)} alimentos por contexto "
        f"culinario español. Devuelve un array JSON con un objeto por "
        f"alimento, usando el id EXACTO recibido.\n\n{foods_json}"
    )


# ---------------------------------------------------------------------------
# Standalone smoke test
# ---------------------------------------------------------------------------
# T1.2: run `python3 scripts/_label_prompt.py` to verify the module prints
# SYSTEM_PROMPT and a sample user message without error.
#
# NOTE on FoodInput: the real FoodInput Pydantic model is defined in
# bulk_label_foods.py (T2.2, not yet implemented). For this standalone smoke
# test we use a plain dataclass with identical field names so the module is
# self-contained and verifiable without any dependency on Phase 2 code.
# This is documented as an intentional design choice: _label_prompt.py must
# remain importable independently of the orchestrator.
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    @dataclasses.dataclass
    class _DummyFood:
        id: str
        name: str
        brand: str | None = None
        category: str | None = None
        subgroup: str | None = None

    sample_batch = [
        _DummyFood(
            id="abc001",
            name="Arroz blanco cocido",
            brand=None,
            category="carbs",
            subgroup="grains",
        ),
        _DummyFood(
            id="abc002",
            name="Harina de trigo",
            brand="Hacendado",
            category="carbs",
            subgroup="flours",
        ),
        _DummyFood(
            id="abc003",
            name="Pechuga de pollo a la plancha",
            brand=None,
            category="protein",
            subgroup="poultry",
        ),
        _DummyFood(
            id="abc004",
            name="Yogur natural",
            brand="Danone",
            category="dairy",
            subgroup=None,
        ),
        _DummyFood(
            id="abc005",
            name="Choco Krispies",
            brand="Kellogg's",
            category="carbs",
            subgroup="breakfast_cereals",
        ),
    ]

    print("=" * 72)
    print("SYSTEM_PROMPT")
    print("=" * 72)
    print(SYSTEM_PROMPT)
    print()
    print("=" * 72)
    print(f"SAMPLE USER MESSAGE ({len(sample_batch)} foods)")
    print("=" * 72)
    print(build_user_message(sample_batch))
    print()
    print(f"[OK] PROMPT_VERSION={PROMPT_VERSION}  len(SYSTEM_PROMPT)={len(SYSTEM_PROMPT)}")
