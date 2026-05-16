"""System prompt + user message builder for the LLM exchange judge.

v2.0.0 — refactor drástico desde v1.7.0:
  - De 18 reglas → 7 reglas concretas + ejemplos
  - El payload incluye AHORA equivalent_amount + macros_at_eq por candidato
    así el LLM NO calcula ratios — solo juzga coherencia.
  - Rol: nutricionista clínica senior 20+ años (no "experto gastronomía").
  - Reglas priorizadas: la primera que falla manda al final/removed.

Source: feedback del cliente Hugo (auditoría real con 14 casos).

Editing rules of thumb:
- Mantener bajo 250 líneas — la concisión es feature.
- Bump PROMPT_VERSION en cambios sustanciales.
- Ejemplos en español peninsular (target).
- NO añadir reglas sin pelearlas — cada regla más diluye las demás.
"""

from __future__ import annotations

import dataclasses
import json

JUDGE_PROMPT_VERSION = "2.0.0"

SYSTEM_PROMPT = """\
Eres una nutricionista clínica senior con más de 20 años de experiencia
en consulta privada en España, especializada en planificación de menús
para mujeres adultas y diseño de listas de intercambios. Tu criterio
combina rigor matemático y sentido común culinario: un intercambio solo
vale si una mujer real con poco tiempo lo aceptaría en su comida.

INPUT — recibes:
  - ORIGEN: alimento buscado + cantidad real (gramos) + macros al gramaje.
  - CANDIDATOS: lista con name, category, subgroup, dairy_subfamily,
    culinary_role, exotic, oil_added, equivalent_amount (ya calculado),
    macros_at_eq (macros del candidato AL equivalent_amount).
  Como YA tenés equivalent_amount y macros_at_eq, NO calculás ratios:
  comparás directamente origen.macros contra candidato.macros_at_eq.

OUTPUT — devolves EXCLUSIVAMENTE este JSON:
  {
    "ranked_ids": ["<id1>", "<id2>", ...],
    "removed_ids": ["<idX>", ...],
    "insufficient_matches": false,
    "rationale": "<máx 20 palabras>"
  }
Sin texto fuera del JSON. Sin markdown. Sin explicaciones extra.

LAS 7 REGLAS (en orden de prioridad — la primera que falla manda):

1. CATEGORÍA / FAMILIA respetada.
   Mismo category. Dentro de dairy, mismo dairy_subfamily (frescos_proteicos
   / quesos_solidos / liquidos / grasas_lacteas / postres_lacteos).
   Dentro de fat, aceite ↔ aguacate ↔ frutos secos ↔ aceitunas ↔ semillas
   ↔ tahín ↔ crema de cacahuete es VÁLIDO (puente de grasas reales).
   Pares fuera de familia → removed_ids o final.
   Ej. yogur griego → manchego curado: distinto dairy_subfamily → final.

2. COHERENCIA CALÓRICA en alimentos mixtos.
   Origen es mixto si tiene proteína > 5g/100g Y grasa > 5g/100g
   (huevo, salmón, yogur griego entero, aguacate, hummus, queso fresco
   entero, frutos secos).
   Si el candidato pierde más de 25% de las calorías del origen
   (macros_at_eq.calories < origen.calories_at_amount × 0.75) → final.
   Si pierde más de 35% → removed_ids.
   Ej. huevo 100g (150 kcal) → merluza ~70 kcal al gramaje equivalente
   pierde 53% → removed_ids. Salmón ~130 kcal pierde 13% → arriba.

3. CANTIDAD ABSURDA con thresholds contextuales.
   ratio = equivalent_amount / amount_searched
   Si ratio > umbral correspondiente → final, o removed si ratio > 1.5×
   umbral.
     - dairy / fat / bebida / postre / snack / salsa: umbral 2.5
     - hidrato seco vs cocido (grains/tubers/legumes crudo ↔ cocido): 5
     - resto: 3
   Ej. skyr 125g → gelatina yogur 568g (ratio 4.5, dairy) → removed.
   Ej. arroz crudo 60g → patata cocida 250g (ratio 4.2, hidrato) → OK.

4. ROL CULINARIO.
   Si origen es meal_dish/staple, los candidatos snack /
   recipe_ingredient / dessert son irrelevantes en consulta. → removed.
   Ej. arroz hervido → harina de trigo / All-Bran / muesli / picos →
   removed.

5. PRODUCTOS "CON ACEITE AÑADIDO" si origen es grasa pura.
   Si origen es aceite, aguacate, frutos secos, aceitunas, semillas,
   tahín, crema cacahuete, y candidato tiene oil_added=true (atún en
   aceite, berenjena frita, sofrito, vinagreta, tomate seco con aceite,
   ajos/pimientos/boletus en aceite) → removed_ids.
   No es cambiar aguacate; es buscar "cosas que llevan aceite".

6. EXÓTICOS / CASQUERÍA al final.
   Si origen NO es exotic, los candidatos con exotic=true (nécora,
   percebe, bogavante, vieira, pulmón, sesos, callos, avestruz, jabalí,
   anguila, rabo de toro, foie) → final del ranked_ids o removed.

7. INSUFFICIENT MATCHES — honesto cuando no hay match.
   Si tras aplicar 1-6 quedan menos de 3 candidatos culinariamente
   válidos, marcar insufficient_matches=true (el frontend muestra
   mensaje honesto en vez de forzar resultados raros).
   Si quedan ≥3, insufficient_matches=false aunque algunos vayan al
   final.

RECORDÁ:
  - El gramaje del candidato (equivalent_amount) ya está calculado para
    igualar el macro ancla. No recalculés. Comparás macros_at_eq.
  - Cuando dudes entre final de ranked y removed, elegí final
    (removed es solo para incompatibilidad clínica clara).
  - ranked_ids debe contener TODOS los ids no incluidos en removed_ids.
  - Devuelve SOLO el JSON. Sin markdown, sin texto.\
"""


def build_judge_user_message(origin, candidates, triggered_reasons=None,
                              amount_searched: float | None = None) -> str:
    """Build the user message for one LLM judge call.

    Pasamos `amount_searched` (gramos del origen buscados por la
    clienta) + `equivalent_amount` y `macros_at_eq` por candidato (ya
    calculados por el frontend). Así el LLM no hace aritmética — solo
    compara y juzga coherencia.

    Parameters
    ----------
    origin: FoodFlags Pydantic model.
    candidates: list[FoodFlags].
    triggered_reasons: list[str] e.g. ["S2","S4"] — context.
    amount_searched: gramos buscados por la usuaria (default 100 si None).

    Returns
    -------
    str — user content para el LLM.
    """
    if triggered_reasons is None:
        triggered_reasons = []
    amt = amount_searched or 100.0

    def _macros_at(food_obj, grams: float) -> dict:
        """Compute origin macros at the searched amount."""
        scale = grams / 100.0
        return {
            "calories": round((getattr(food_obj, "calories", 0) or 0) * scale, 1),
            "protein":  round((getattr(food_obj, "protein",  0) or 0) * scale, 1),
            "fat":      round((getattr(food_obj, "fat",      0) or 0) * scale, 1),
            "carbs":    round((getattr(food_obj, "carbs",    0) or 0) * scale, 1),
        }

    origin_payload = {
        "id": origin.id,
        "name": origin.name,
        "category": origin.category,
        "subgroup": origin.subgroup,
        "dairy_subfamily": getattr(origin, "dairy_subfamily", None),
        "culinary_role": getattr(origin, "culinary_role", None),
        "exotic": origin.exotic,
        "oil_added": getattr(origin, "oil_added", None),
        "amount_searched_g": amt,
        "macros_at_amount": _macros_at(origin, amt),
        "macros_per_100g": {
            "calories": origin.calories,
            "protein":  getattr(origin, "protein",  None),
            "fat":      getattr(origin, "fat",      None),
            "carbs":    getattr(origin, "carbs",    None),
        },
        "usage_es": getattr(origin, "usage_es", None),
    }

    cand_payload = []
    for c in candidates:
        eq_amount = getattr(c, "equivalent_amount", None)
        macros_at_eq = getattr(c, "macros_at_eq", None)
        # Fallback: si el frontend no envió equivalent_amount, calcularlo
        # crudamente vía proteína (el anchor más común).
        if eq_amount is None or macros_at_eq is None:
            origin_anchor = origin.protein or origin.calories or 1
            cand_anchor = c.protein or c.calories or 1
            origin_amt_anchor = origin_anchor * (amt / 100.0)
            eq_amount = round(origin_amt_anchor * 100.0 / cand_anchor, 1) \
                if cand_anchor > 0 else amt
            macros_at_eq = _macros_at(c, eq_amount)

        cand_payload.append({
            "id": c.id,
            "name": c.name,
            "category": c.category,
            "subgroup": c.subgroup,
            "dairy_subfamily": getattr(c, "dairy_subfamily", None),
            "culinary_role": getattr(c, "culinary_role", None),
            "exotic": c.exotic,
            "oil_added": getattr(c, "oil_added", None),
            "equivalent_amount_g": eq_amount,
            "macros_at_eq": macros_at_eq,
            "macros_per_100g": {
                "calories": c.calories,
                "protein":  getattr(c, "protein",  None),
                "fat":      getattr(c, "fat",      None),
                "carbs":    getattr(c, "carbs",    None),
            },
            "usage_es": getattr(c, "usage_es", None),
        })

    reasons_str = (
        ", ".join(triggered_reasons)
        if triggered_reasons else "ninguna específica"
    )

    return (
        f"ORIGEN (lo que la clienta busca como intercambio):\n"
        f"{json.dumps(origin_payload, ensure_ascii=False, indent=2)}\n\n"
        f"CANDIDATOS ({len(candidates)} a evaluar):\n"
        f"{json.dumps(cand_payload, ensure_ascii=False, indent=2)}\n\n"
        f"Razones de trigger: {reasons_str}.\n\n"
        f"Aplicá las 7 reglas en orden de prioridad. Devolvé SOLO el JSON "
        f"con ranked_ids / removed_ids / insufficient_matches / rationale."
    )


# ---------------------------------------------------------------------------
# Backward-compat alias for any external import
# ---------------------------------------------------------------------------
PROMPT_VERSION = JUDGE_PROMPT_VERSION


# ---------------------------------------------------------------------------
# Standalone smoke test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    @dataclasses.dataclass
    class _Mock:
        id: str
        name: str
        category: str = "fat"
        subgroup: str = "avocado"
        calories: float | None = 137
        protein: float | None = 1.5
        fat: float | None = 12
        carbs: float | None = 2
        dairy_subfamily: str | None = None
        culinary_role: str | None = "meal_dish"
        exotic: bool | None = False
        oil_added: bool | None = False
        equivalent_amount: float | None = None
        macros_at_eq: dict | None = None
        usage_es: str | None = None

    origin = _Mock(id="o", name="Aguacate")
    cands = [
        _Mock(id="c1", name="Nueces", subgroup="nuts_seeds",
              calories=654, protein=15, fat=65,
              equivalent_amount=18,
              macros_at_eq={"calories": 117, "protein": 2.7, "fat": 11.7, "carbs": 2.4}),
        _Mock(id="c2", name="Aceitunas verdes", subgroup="other_fat",
              calories=145, protein=1, fat=15,
              equivalent_amount=80,
              macros_at_eq={"calories": 116, "protein": 0.8, "fat": 12, "carbs": 4}),
    ]
    print(f"PROMPT_VERSION={JUDGE_PROMPT_VERSION}")
    print(f"SYSTEM_PROMPT len: {len(SYSTEM_PROMPT)}")
    print()
    print(build_judge_user_message(origin, cands, amount_searched=80)[:600])
    print("...")
    print(f"[OK] smoke test passed")
