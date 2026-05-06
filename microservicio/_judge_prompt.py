"""SYSTEM_PROMPT copied verbatim from scripts/_label_prompt.py.
Sync rule: when scripts/_label_prompt.py is updated, copy the SYSTEM_PROMPT block
manually here and run `diff` to verify identity. Two locations exist intentionally
to decouple microservicio deploys from offline labeling script updates.

JUDGE-SPECIFIC NOTE: build_judge_user_message() is defined here only — it does
NOT exist in scripts/_label_prompt.py. That file has build_user_message() for
per-food flag classification; this file has the ranking+removal variant for the
runtime culinary judge.
"""

from __future__ import annotations
import json

# Keep in lockstep with scripts/_label_prompt.py:PROMPT_VERSION
JUDGE_PROMPT_VERSION = "1.0.0"

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
   - comida: legumbres guisadas, arroces, pastas, segundos platos, tubérculos
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


def build_judge_user_message(origin, candidates, triggered_reasons=None) -> str:
    """Build the user message for one LLM judge call.

    This is a RANKING + REMOVAL task, NOT per-food flag classification.
    The system prompt's culinary knowledge is reused; the user message asks
    the LLM to reorder candidates and flag inappropriate ones.

    Parameters
    ----------
    origin: FoodFlags (Pydantic model with .id, .name, .category, .subgroup,
            .ready_to_eat, .raw_ingredient, .meal_slot, .frequency, .exotic,
            .label_confidence, .calories — all may be None)
    candidates: list[FoodFlags] (max 50, same shape as origin)
    triggered_reasons: list[str] e.g. ["S2","S4"] — informational context
                       for the LLM, helps explain why it was called.

    Returns
    -------
    str — the user message content to send as {"role": "user", "content": ...}
    """
    if triggered_reasons is None:
        triggered_reasons = []

    origin_payload = {
        "id": origin.id,
        "name": origin.name,
        "category": origin.category,
        "subgroup": origin.subgroup,
        "ready_to_eat": origin.ready_to_eat,
        "raw_ingredient": origin.raw_ingredient,
        "meal_slot": origin.meal_slot,
        "frequency": origin.frequency,
        "exotic": origin.exotic,
        "label_confidence": getattr(origin, "label_confidence", None),
        "calories": getattr(origin, "calories", None),
    }

    cand_payload = [
        {
            "id": c.id,
            "name": c.name,
            "category": c.category,
            "subgroup": c.subgroup,
            "ready_to_eat": c.ready_to_eat,
            "raw_ingredient": c.raw_ingredient,
            "meal_slot": c.meal_slot,
            "frequency": c.frequency,
            "exotic": c.exotic,
            "label_confidence": getattr(c, "label_confidence", None),
            "calories": getattr(c, "calories", None),
        }
        for c in candidates
    ]

    reasons_str = (
        ", ".join(triggered_reasons)
        if triggered_reasons
        else "ninguna razón específica"
    )

    return (
        f"Tengo el alimento ORIGEN:\n"
        f"{json.dumps(origin_payload, ensure_ascii=False, indent=2)}\n\n"
        f"Y los siguientes {len(candidates)} CANDIDATOS a intercambio:\n"
        f"{json.dumps(cand_payload, ensure_ascii=False, indent=2)}\n\n"
        f"Razones por las que se te consulta (triggers que dispararon): {reasons_str}.\n\n"
        f"Tu tarea: aplicando las reglas culinarias, devuelve EXCLUSIVAMENTE un\n"
        f"objeto JSON con ESTA forma exacta:\n"
        f'{{\n'
        f'  "ranked_ids": ["<id1>", "<id2>", ...],\n'
        f'  "removed_ids": ["<idX>", ...],\n'
        f'  "rationale": "<máx 20 palabras>"\n'
        f"}}\n\n"
        f"Reglas de la respuesta:\n"
        f"- ranked_ids: todos los candidatos aceptables en el orden que propones "
        f"(mejor primero). Usa SOLO ids exactos de los candidatos. No inventes ids.\n"
        f"- removed_ids: candidatos que NO deberían aparecer como intercambio "
        f"(serán demoteados ×0.05, no eliminados). Solo incluye ids con incompatibilidad CLARA.\n"
        f"- ranked_ids debe contener TODOS los ids no incluidos en removed_ids.\n"
        f"- Si todo está bien, devuelve ranked_ids con el orden que consideres "
        f"correcto y removed_ids=[].\n"
        f"- Sin markdown. Sin texto antes ni después del JSON.\n"
    )


# ---------------------------------------------------------------------------
# Standalone smoke test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import dataclasses

    @dataclasses.dataclass
    class _DummyFood:
        id: str
        name: str
        category: str | None = None
        subgroup: str | None = None
        ready_to_eat: bool | None = None
        raw_ingredient: bool | None = None
        meal_slot: str | None = None
        frequency: str | None = None
        exotic: bool | None = None
        label_confidence: int | None = None
        calories: float | None = None

    origin = _DummyFood(
        id="bedca_papa_cruda",
        name="Patata cruda",
        category="carbs",
        subgroup="tubérculos",
        ready_to_eat=False,
        raw_ingredient=False,
        meal_slot="comida",
        frequency="habitual",
        exotic=False,
        label_confidence=92,
        calories=77,
    )

    candidates = [
        _DummyFood(
            id="bedca_batata",
            name="Batata / boniato crudo",
            category="carbs",
            subgroup="tubérculos",
            ready_to_eat=False,
            raw_ingredient=False,
            meal_slot="comida",
            frequency="habitual",
            exotic=False,
            label_confidence=88,
            calories=86,
        ),
        _DummyFood(
            id="bedca_yuca",
            name="Yuca cruda",
            category="carbs",
            subgroup="tubérculos",
            ready_to_eat=False,
            raw_ingredient=False,
            meal_slot="comida",
            frequency="raro",
            exotic=True,
            label_confidence=75,
            calories=160,
        ),
        _DummyFood(
            id="bedca_harina_trigo",
            name="Harina de trigo",
            category="carbs",
            subgroup=None,
            ready_to_eat=False,
            raw_ingredient=True,
            meal_slot="any",
            frequency="habitual",
            exotic=False,
            label_confidence=98,
            calories=341,
        ),
        _DummyFood(
            id="bedca_arroz_blanco",
            name="Arroz blanco crudo",
            category="carbs",
            subgroup="cereales",
            ready_to_eat=False,
            raw_ingredient=False,
            meal_slot="comida",
            frequency="habitual",
            exotic=False,
            label_confidence=95,
            calories=358,
        ),
        _DummyFood(
            id="bedca_ñame",
            name="Ñame crudo",
            category="carbs",
            subgroup="tubérculos",
            ready_to_eat=False,
            raw_ingredient=False,
            meal_slot="comida",
            frequency="raro",
            exotic=True,
            label_confidence=70,
            calories=118,
        ),
    ]

    print("=" * 72)
    print("SYSTEM_PROMPT")
    print("=" * 72)
    print(SYSTEM_PROMPT)
    print()
    print("=" * 72)
    print(f"SAMPLE USER MESSAGE (1 origin + {len(candidates)} candidates)")
    print("=" * 72)
    msg = build_judge_user_message(
        origin, candidates, triggered_reasons=["S2", "S4"])
    print(msg)
    print()
    print(
        f"[OK] JUDGE_PROMPT_VERSION={JUDGE_PROMPT_VERSION} "
        f"len(SYSTEM_PROMPT)={len(SYSTEM_PROMPT)} "
        f"candidates={len(candidates)}"
    )
