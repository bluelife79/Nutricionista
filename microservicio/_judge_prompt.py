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
JUDGE_PROMPT_VERSION = "1.6.0"

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

11. DIVERSIDAD EN RANKING (REGLA DURA, no opcional):
    a. Identificá el "alimento base" de cada candidato — la raíz ignorando
       estado de cocción, corte, marca y conservación. Ejemplos:
         "patata asada", "patata cruda", "patata hervida"  → base "patata"
         "pollo plancha", "pollo asado", "pollo a la plancha" → base "pollo"
         "garbanzo cocido", "garbanzo seco", "garbanzos en bote" → base "garbanzo"
       Si dos candidatos comparten el mismo alimento base, son VARIANTES
       del mismo alimento — aunque tengan ids distintos y macros distintas.

    b. En el TOP del ranking podés incluir COMO MÁXIMO UNA variante por
       alimento base. La mejor variante = la que mejor matchea con el
       ORIGEN considerando estado, contexto culinario y macros.

    c. Las variantes extras del mismo alimento base van al FINAL del
       ranked_ids (no a removed_ids — siguen siendo válidas, solo
       postergadas). El usuario quiere VARIEDAD entre alimentos
       distintos, no 5 patatas seguidas con distinto método de cocción.

    d. CASO DEL ORIGEN VAGO: si el ORIGEN no especifica estado (ej. solo
       "Arroz" sin "crudo" ni "cocido", o "Pollo" sin método de cocción),
       la regla SIGUE APLICANDO IGUAL: una sola "patata" en el top, una
       sola "pasta", una sola "quinoa". No uses la ambigüedad del origen
       como excusa para incluir múltiples variantes.

    e. La meta clínica: que la pantalla muestre 6-8 alimentos DIFERENTES
       (arroz origen → quinoa, pasta, cuscús, mijo, patata, boniato,
       polenta...), no 6 patatas con distintos verbos de cocción.

12. FILTRO CLÍNICO ESPAÑA (manda a removed_ids cuando aplica):
    SEÑAL PRIMARIA: el campo `usage_es` (cuando está presente) describe en
    25-40 palabras el uso culinario real en España de cada alimento. Úsalo
    como tu fuente principal para decidir si un candidato es intercambio
    válido. Ej: si usage_es dice "no se consume crudo, requiere cocción",
    "exclusivo desayuno", o "ingrediente de bollería, no plato directo",
    eso decide la categoría más que los flags.

    Cuando el ORIGEN es un alimento HABITUAL en dieta española y un
    candidato es claramente NO INTERCAMBIABLE en la práctica real, mandalo
    a removed_ids (NO al final de ranked_ids). Casos:

    a. INSUMOS DE COCINA cuando origen NO es insumo:
       - harinas (de trigo, maíz, centeno, cebada, avena, espelta...)
       - sémola, almidón, fécula, fariña, maicena
       - copos deshidratados ("puré en copos", "patata en copos")
       Estos NO se comen como plato — se transforman en otros alimentos.
       Ej: origen "Arroz" → harina de trigo a removed_ids.

    b. GRANOS CRUDOS NO HABITUALES cuando origen es habitual:
       - "Centeno crudo" (España consume PAN de centeno, no el grano)
       - "Mijo" como grano (poco habitual fuera de cocina sana específica)
       - "Cebada cruda" (igual que centeno)
       - "Alpiste", "Sorgo", "Amaranto", "Teff" (raros en España)
       Ej: origen "Arroz" (habitual) + "Centeno crudo" (ocasional/raro
       en práctica española) → centeno a removed_ids.

    c. ALIMENTOS DE OTRO MEAL_SLOT cuando origen es comida/cena:
       - Cereales de desayuno (trigo, maíz, avena con miel, muesli,
         granola, copos azucarados) cuando origen es comida
       - Panes (blanco, integral, centeno, molde, baguette, tostada,
         biscote) cuando origen es comida — aunque tengan macros similares
       Ej: origen "Arroz" (comida) + "Cereales desayuno base trigo,
       avena, maíz y miel" (desayuno) → cereales a removed_ids.

    d. NO REMOVAS los siguientes (siempre son intercambios válidos):
       - Otros granos COCIDOS o LISTOS PARA COCINAR (pasta, quinoa,
         cuscús, bulgur — todos son comida real en España)
       - Tubérculos (patata, boniato, batata, yuca) — intercambio carb
         legítimo aunque distinto subgroup
       - Legumbres cocidas — fuente carbohidrato y proteína conjunta

    e. Cuando dudes entre relegar (ranked_ids al final) vs remover
       (removed_ids), remové SOLO si el alimento es CLARAMENTE no usable
       en el contexto del origen. En duda, relegá al final del ranked_ids.

13. INTERCAMBIO INSUFICIENTE: si después de aplicar todas las reglas
    quedan MENOS DE 3 candidatos genuinamente intercambiables (válidos
    tanto en macros como culinariamente), indicá "insufficient_matches":
    true en tu respuesta. El frontend mostrará un mensaje honesto en lugar
    de forzar resultados inapropiados. Casos típicos: chocolate negro,
    aceites muy específicos, alimentos sin equivalente culinario real.

14. JERARQUÍA DE PROCESADO (aplica en ranked_ids, NO en removed_ids):
    Dentro del mismo grupo culinario, poné primero el alimento MÁS
    SIMPLE y al final el más procesado. Jerarquía orientativa:
      0. Ingrediente simple (garbanzo cocido, pollo a la plancha, lenteja)
      1. Conserva básica sin aditivos (atún al natural, garbanzo en bote)
      2. Preparado con sazonado simple (atún en aceite de oliva)
      3. Elaborado/saborizado (garbanzos al garam masala, lomo adobado,
         salmón ahumado, escalopines marinados)
      4. Ultraprocesado (burger meat, frankfurt, salchichas elaboradas)
    No removés los procesados — solo los relegás al final del ranked_ids.

15. ALIMENTOS MIXTOS — REGLA CLÍNICA CRÍTICA del cliente.

    Un alimento ORIGEN es MIXTO cuando tiene TANTO proteína significativa
    (>5g/100g) COMO grasa significativa (>5g/100g). Ejemplos típicos:
    huevo (12.5p / 11g), salmón (20p / 13g), yogur griego entero
    (5p / 10g), aguacate (2p / 15g), hummus, queso fresco entero, frutos
    secos, quesos curados.

    Para estos orígenes, la equivalencia NUNCA es solo proteína. Aplicá
    este cálculo en cada candidato (los macros vienen por 100g):

      ratio_proteina = origen.protein / candidato.protein
      gramos_equivalentes = 100 × ratio_proteina (aprox para igualar proteína)
      kcal_candidato_equivalente = candidato.calories × gramos_equivalentes / 100
      kcal_perdidas_pct = 1 - (kcal_candidato_equivalente / origen.calories)

    Reglas DURAS (cliente fue explícito):
      - Si kcal_perdidas_pct > 25%  → enviá al FINAL de ranked_ids.
      - Si kcal_perdidas_pct > 35%  → enviá a removed_ids.
      - Si candidato.fat es < 25% de origen.fat → tratá como pérdida grave
        aunque las kcal cuadren (la grasa da saciedad y energía).

    Ejemplo concreto del cliente para huevo (12.5p, 11g grasa, 150 kcal):
      - merluza (12p prot, 1g grasa, 67 kcal):
          gramos_eq = 100 × 12.5/12 ≈ 104g  →  ~70 kcal → pierde 53% kcal
          → removed_ids (pierde más del 35%)
      - langostino, rape, panga, clara de huevo (90 kcal): mismo caso.
      - salmón (20p, 13g, 200 kcal):
          gramos_eq = 100 × 12.5/20 ≈ 63g  →  ~126 kcal → pierde 16% kcal
          → OK como intercambio (sube en ranked_ids).
      - sardina/caballa/arenque: equivalente, suben arriba.
      - tortilla francesa, huevo en otra preparación: T1 familia, suben.

    NO confundir alimentos mixtos con proteínas magras puras (pollo
    pechuga, atún, pavo). Para esas, esta regla NO se aplica — usá la
    jerarquía normal de subgrupos y procesado.

16. LÁCTEOS — JERARQUÍA POR USO CULINARIO (cliente punto 4).

    Cada lácteo tiene un campo "dairy_subfamily" precalculado con uno de
    5 valores que reflejan USO real en cocina española:

      - frescos_proteicos: yogur (natural / griego / desnatado / sabores),
        skyr, Fage, quark, kéfir, queso fresco batido 0%, queso fresco
        tipo Burgos, requesón, mató, ricotta, cottage, mozzarella fresca.
        USO: postre, snack proteico, desayuno, base de bowl.

      - quesos_solidos: manchego, parmesano, cheddar, gouda, gruyere,
        brie, camembert, roquefort, feta, halloumi, lonchas, quesitos,
        queso fundido, queso para untar.
        USO: aperitivo, fiambre, gratinar.

      - liquidos: leche entera/semi/desnatada/sin lactosa, bebidas
        vegetales (almendra/avena/soja/coco), yogur bebible.
        USO: desayuno, café, recetas líquidas.

      - grasas_lacteas: nata líquida/montada/para cocinar, crème fraîche,
        crema agria, mascarpone.
        USO: repostería, topping, salsa.

      - postres_lacteos: flan, natillas, panna cotta, tiramisú,
        cheesecake, helado, sorbete, dulce de leche, leche condensada,
        leche evaporada, arroz con leche, cuajada con miel.
        USO: postre dulce ocasional.

    REGLA: respetá la subfamilia. Cuando origen es de subfamilia X, los
    candidatos de SUBFAMILIA X van arriba; los de OTRA subfamilia van al
    final o a removed_ids si la incompatibilidad es total.

    Ejemplos concretos del cliente para yogur griego (frescos_proteicos):
      - Yogur natural / griego / skyr / kéfir / requesón / queso fresco
        batido / Burgos / ricotta → frescos_proteicos → TOP de ranked_ids.
      - Manchego / queso fundido / lonchas / quesitos → quesos_solidos
        → FINAL de ranked_ids (uso distinto).
      - Nata montada → grasas_lacteas → removed_ids (no es sustituto
        natural de yogur).
      - Leche de almendras 382g / bebida vegetal → liquidos → removed_ids
        (cantidad absurda + uso distinto, doble penalización).
      - Flan / natilla / helado → postres_lacteos → final o removed.

    Esta regla COMBINA con la regla 15 (alimentos mixtos): si origen es
    yogur griego (frescos_proteicos + mixto), los candidatos deben pasar
    AMBAS reglas — misma subfamilia Y respetar coherencia calórica.

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
        "dairy_subfamily": getattr(origin, "dairy_subfamily", None),
        "ready_to_eat": origin.ready_to_eat,
        "raw_ingredient": origin.raw_ingredient,
        "meal_slot": origin.meal_slot,
        "frequency": origin.frequency,
        "exotic": origin.exotic,
        "label_confidence": getattr(origin, "label_confidence", None),
        # Macros per 100g — necesarios para Regla 15 (coherencia de
        # alimentos mixtos). Sin protein + fat el juez no puede calcular
        # el ratio de pérdida calórica relativo a la cantidad equivalente.
        "calories": getattr(origin, "calories", None),
        "protein":  getattr(origin, "protein",  None),
        "fat":      getattr(origin, "fat",      None),
        "carbs":    getattr(origin, "carbs",    None),
        # Descripción enriquecida del uso culinario español (audit_usage_with_llm.py).
        # Cuando está presente, ayuda al juicio clínico — explica el rol del
        # alimento ("plato directo" vs "ingrediente de cocina") sin que el LLM
        # tenga que inferirlo de los flags.
        "usage_es": getattr(origin, "usage_es", None),
    }

    cand_payload = [
        {
            "id": c.id,
            "name": c.name,
            "category": c.category,
            "subgroup": c.subgroup,
            "dairy_subfamily": getattr(c, "dairy_subfamily", None),
            "ready_to_eat": c.ready_to_eat,
            "raw_ingredient": c.raw_ingredient,
            "meal_slot": c.meal_slot,
            "frequency": c.frequency,
            "exotic": c.exotic,
            "label_confidence": getattr(c, "label_confidence", None),
            "calories": getattr(c, "calories", None),
            "protein":  getattr(c, "protein",  None),
            "fat":      getattr(c, "fat",      None),
            "carbs":    getattr(c, "carbs",    None),
            "usage_es": getattr(c, "usage_es", None),
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
        f'  "insufficient_matches": false,\n'
        f'  "rationale": "<máx 20 palabras>"\n'
        f"}}\n\n"
        f"Reglas de la respuesta:\n"
        f"- ranked_ids: todos los candidatos aceptables en el orden que propones "
        f"(mejor primero). Usa SOLO ids exactos de los candidatos. No inventes ids.\n"
        f"- removed_ids: candidatos que NO deberían aparecer como intercambio "
        f"(serán demoteados ×0.05, no eliminados). Solo incluye ids con incompatibilidad CLARA.\n"
        f"- ranked_ids debe contener TODOS los ids no incluidos en removed_ids.\n"
        f"- insufficient_matches: true SOLO si tras aplicar todas las reglas quedan "
        f"MENOS DE 3 candidatos culinariamente válidos (aplica regla 13). "
        f"En la mayoría de casos debe ser false.\n"
        f"- Si todo está bien, devuelve ranked_ids con el orden que consideres "
        f"correcto, removed_ids=[] e insufficient_matches=false.\n"
        f"- DIVERSIDAD (regla DURA — aplicar SIEMPRE):\n"
        f"  * Identificá el alimento base de cada candidato (raíz sin "
        f"estado/cocción/corte/marca). \"patata cruda/asada/hervida\" → base "
        f"\"patata\"; \"pollo plancha/asado\" → base \"pollo\".\n"
        f"  * En el TOP del ranked_ids, MÁXIMO UNA variante por alimento base. "
        f"Elegí la mejor para matchear con el ORIGEN.\n"
        f"  * Las variantes restantes van al FINAL del ranked_ids (NO a "
        f"removed_ids — siguen siendo válidas, solo postergadas).\n"
        f"  * Si el ORIGEN no especifica estado de cocción (ej. solo \"Arroz\" "
        f"sin \"crudo\"/\"cocido\"), la regla aplica IGUAL: una sola patata, "
        f"una sola pasta, una sola quinoa en el top. No usar la ambigüedad "
        f"del origen como excusa para incluir múltiples variantes.\n"
        f"  * Meta: el TOP del ranking debe mostrar alimentos DIFERENTES, no "
        f"el mismo alimento con distintos verbos de cocción.\n"
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
