"use strict";

const assert = require("assert");
const vm = require("vm");
const { createEngine } = require("./lib/algorithm_harness");
const {
  REQUIRED_EXCLUDED_IDS,
  REQUIRED_COMPATIBLE_IDS,
  runScopeAudit,
} = require("./audit_premium22_scope");

const CORE_ORIGINS = [
  ["bedca_0853", 40],
  ["bedca_0179", 150],
  ["bedca_0288", 60],
  ["bedca_0135", 150],
  ["bedca_0037", 125],
  ["bedca_0070", 60],
  ["bedca_0462", 120],
  ["bedca_0447", 200],
  ["bedca_0353", 20],
  ["bedca_0081", 10],
];

const REFERENCE_IDS = [
  "manual_choco_0002",
  "bedca_0187",
  "bedca_0395",
  "off_1627f0f609",
  "off_0aba323a23",
];

const RECOVERED_SIMPLE_CORE_IDS = ["off_596ef3dfe1"];

function assertSearchNeverReturns(search, query, forbiddenIds) {
  const results = Array.from(search(query));
  for (const food of results) {
    assert(
      !forbiddenIds.has(food.id),
      `${query}: apareció un producto excluido (${food.name})`,
    );
  }
  return results;
}

async function main() {
  const audit = runScopeAudit();
  assert.strictEqual(audit.totals.profiled, audit.totals.foods);
  assert(audit.totals.exchange_core >= 1000, "El núcleo quedó sin cobertura");
  assert(audit.totals.reference_only >= 100, "Faltan referencias controladas");
  assert(audit.totals.excluded >= 2000, "El filtro de exclusión no está activo");
  assert(audit.totals.core_nova_4 > 0, "NOVA 4 sigue actuando como veto total");
  assert(
    audit.totals.core_with_sweeteners > 0,
    "No se recuperaron lácteos compatibles con edulcorantes",
  );
  assert.strictEqual(audit.totals.core_nova_4_without_guidance, 0);
  assert.strictEqual(audit.totals.core_sweeteners_without_guidance, 0);
  assert.strictEqual(audit.totals.core_added_sugar_without_guidance, 0);
  assert.strictEqual(audit.totals.core_without_choice_guidance, 0);
  assert.strictEqual(audit.totals.core_name_contaminations, 0);
  assert.strictEqual(audit.totals.excluded_required_missing, 0);
  assert.strictEqual(audit.totals.compatible_required_missing, 0);

  const engine = createEngine();
  const forbiddenIds = new Set(REQUIRED_EXCLUDED_IDS);
  const search = vm.runInContext("getLocalSearchResults", engine.context);

  for (const id of REQUIRED_EXCLUDED_IDS) {
    const food = engine.foods.find((item) => item.id === id);
    assert(food, `Falta caso negativo ${id}`);
    assert.strictEqual(
      engine.window.getPremiumExchangeScope(food).status,
      "excluded",
      `${food.name}: debía estar excluido`,
    );
  }

  for (const id of REFERENCE_IDS) {
    const food = engine.foods.find((item) => item.id === id);
    assert(food, `Falta referencia ${id}`);
    assert.strictEqual(
      engine.window.getPremiumExchangeScope(food).status,
      "reference_only",
      `${food.name}: debía ser solo referencia`,
    );
  }

  for (const id of RECOVERED_SIMPLE_CORE_IDS) {
    const food = engine.foods.find((item) => item.id === id);
    assert(food, `Falta alimento simple recuperado ${id}`);
    assert.strictEqual(
      engine.window.getPremiumExchangeScope(food).status,
      "exchange_core",
      `${food.name}: un producto simple y verificado no debe quedar relegado`,
    );
  }

  for (const id of REQUIRED_COMPATIBLE_IDS) {
    const food = engine.foods.find((item) => item.id === id);
    assert(food, `Falta alternativa compatible ${id}`);
    assert.strictEqual(
      engine.window.getPremiumExchangeScope(food).status,
      "exchange_core",
      `${food.name}: debía poder intercambiarse`,
    );
    const guidance = engine.window.getPremiumChoiceGuidance(food);
    assert.strictEqual(
      guidance.level,
      "compatible",
      `${food.name}: debía llevar aviso compatible`,
    );
    assert(
      Number(guidance.rank_factor) < 1,
      `${food.name}: debía quedar detrás de una elección prioritaria`,
    );
  }

  for (const query of [
    "yatekomo",
    "avecrem",
    "cubito de caldo",
    "salchichón",
    "lasaña",
    "zumo naranja",
    "tortilla de patata",
  ]) {
    assertSearchNeverReturns(search, query, forbiddenIds);
  }

  for (const query of [
    "avena",
    "arroz",
    "pasta",
    "garbanzo",
    "yogur natural",
    "mozzarella",
    "tofu",
    "leche",
    "pollo",
    "yogur fresa",
  ]) {
    const results = assertSearchNeverReturns(search, query, forbiddenIds);
    assert(results.length > 0, `${query}: búsqueda saludable vacía`);
    assert(
      results.every((food) =>
        engine.window.isPremiumExchangeSearchable(food),
      ),
      `${query}: la búsqueda devolvió un registro no publicable`,
    );
  }

  for (const [id, amount] of CORE_ORIGINS) {
    const origin = engine.foods.find((food) => food.id === id);
    assert(origin, `Falta origen ${id}`);
    assert.strictEqual(
      engine.window.getPremiumExchangeScope(origin).status,
      "exchange_core",
      `${origin.name}: el origen debe pertenecer al núcleo`,
    );
    const result = await engine.calculate(origin, amount);
    const all = [
      ...result.intercambios,
      ...result.familia,
      ...result.preparados,
    ];
    assert(all.length > 0, `${origin.name}: intercambio vacío`);
    for (const candidate of all) {
      assert(
        engine.window.isPremiumExchangeCandidateEligible(candidate, origin),
        `${origin.name}: candidato fuera de alcance (${candidate.name})`,
      );
      const guidance = engine.window.getPremiumChoiceGuidance(candidate);
      if (Number(candidate.processing_evidence?.nova_group) === 4) {
        assert.strictEqual(
          guidance.level,
          "compatible",
          `${origin.name}: NOVA 4 sin aviso (${candidate.name})`,
        );
      }
      if (Number(candidate.processing_evidence?.sweeteners_n || 0) > 0) {
        assert.strictEqual(
          guidance.level,
          "compatible",
          `${origin.name}: edulcorantes sin aviso (${candidate.name})`,
        );
      }
      if (
        engine.window.getPremiumAddedSugarAssessment(candidate).status ===
        "detected"
      ) {
        assert.strictEqual(
          guidance.level,
          "compatible",
          `${origin.name}: azúcar añadido sin aviso (${candidate.name})`,
        );
      }
      assert(!forbiddenIds.has(candidate.id));
    }
  }

  const plainYogurt = engine.foods.find((food) => food.id === "bedca_0037");
  const plainResult = await engine.calculate(plainYogurt, 125);
  const plainCandidates = [
    ...plainResult.intercambios,
    ...plainResult.familia,
    ...plainResult.preparados,
  ];
  assert(
    plainCandidates.every(
      (food) =>
        !(
          engine.window.getPremiumChoiceGuidance(food).reason_codes || []
        ).includes(
          "flavoured_product",
        ),
    ),
    "Un yogur natural recibió lácteos saborizados",
  );

  console.log(
    `PASS Premium 2.2 scope: ${audit.totals.exchange_core} núcleo, ` +
      `${audit.totals.reference_only} referencia, ` +
      `${audit.totals.excluded + audit.totals.not_publishable} fuera; ` +
      `${audit.totals.compatible_choices} alternativas compatibles explicadas`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
