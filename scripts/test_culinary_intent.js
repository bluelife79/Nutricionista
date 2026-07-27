"use strict";

const assert = require("assert");
const { createEngine, findFood } = require("./lib/algorithm_harness");
const { runIntentAudit } = require("./audit_culinary_intent");

function visible(food, runtime) {
  return Boolean(
    food &&
      food.quality_status !== "quarantine" &&
      !(food.flags || []).includes("hidden") &&
      food.subgroup &&
      food.subgroup !== "?" &&
      (
        typeof runtime.isPremiumExchangeSearchable !== "function" ||
        runtime.isPremiumExchangeSearchable(food)
      ),
  );
}

const CASES = [
  {
    name: "mozzarella",
    id: "bedca_0070",
    prompt: "cheese_use",
    expected: ["cold", "melt"],
    amount: 60,
  },
  {
    name: "avena",
    query: "Avena en Copos",
    aliases: ["Copos de avena", "Avena"],
    prompt: "oats_use",
    expected: ["breakfast_bowl", "savory"],
    amount: 40,
  },
  {
    name: "pan",
    query: "Pan integral",
    prompt: "bread_use",
    expected: ["toast", "sandwich"],
    amount: 60,
  },
  {
    name: "pollo",
    query: "Pechuga de pollo",
    prompt: "meat_use",
    expected: ["main_piece", "stew"],
    amount: 120,
  },
  {
    name: "pescado",
    query: "Merluza",
    aliases: ["Lomos de merluza"],
    prompt: "fish_use",
    expected: ["main_piece", "stew"],
    amount: 150,
  },
  {
    name: "proteína vegetal",
    query: "Tofu",
    prompt: "plant_protein_use",
    expected: ["main_piece", "stew", "minced"],
    amount: 100,
  },
  {
    name: "legumbre",
    id: "bedca_0581",
    prompt: "legume_use",
    expected: ["stew", "salad"],
    amount: 150,
  },
  {
    name: "lácteo fermentado",
    id: "bedca_0037",
    prompt: "fermented_dairy_use",
    expected: ["spoon", "cooking_sauce"],
    amount: 125,
  },
  {
    name: "verdura",
    id: "bedca_0028",
    prompt: "vegetable_use",
    expected: ["salad", "cooked_side", "soup"],
    amount: 150,
  },
];

async function main() {
  const audit = runIntentAudit();
  const engine = createEngine();
  const allProfiles = engine.foods.map((food) => food.culinary_intent);
  assert.strictEqual(
    allProfiles.length,
    5324,
    "El catálogo Premium 2.2 debe conservar los 5.324 registros trazables",
  );
  assert(
    allProfiles.every(
      (profile) =>
        profile &&
        profile.version === engine.window.PREMIUM_INTENT_VERSION &&
        typeof profile.family === "string" &&
        Array.isArray(profile.uses) &&
        profile.uses.length > 0 &&
        Array.isArray(profile.primary_uses) &&
        profile.primary_uses.every((mode) => profile.uses.includes(mode)) &&
        Array.isArray(profile.validated_modes) &&
        typeof profile.validation_status === "string",
    ),
    "Todo registro debe conservar un perfil culinario versionado y coherente",
  );
  const visibleFoods = engine.foods.filter((food) => visible(food, engine.window));
  const validatedFoods = visibleFoods.filter(
    (food) =>
      food.culinary_intent.validation_status === "release_validated",
  );
  const silentFoods = visibleFoods.filter(
    (food) => food.culinary_intent.validation_status === "release_silent",
  );
  const nonPublishableFoods = engine.foods.filter(
    (food) => !visible(food, engine.window),
  );
  assert.strictEqual(
    validatedFoods.length,
    audit.totals.prompted_foods,
    "La UI debe servir exactamente las preguntas aprobadas por la auditoría",
  );
  assert(
    validatedFoods.every(
      (food) =>
        food.culinary_intent.prompt_id &&
        food.culinary_intent.validated_modes.length >= 2,
    ),
    "Ninguna pregunta puede publicarse sin dos modalidades validadas",
  );
  assert(
    silentFoods.every(
      (food) =>
        food.culinary_intent.prompt_id === null &&
        food.culinary_intent.validated_modes.length === 0,
    ),
    "Los alimentos silenciosos no deben conservar preguntas residuales",
  );
  assert(
    nonPublishableFoods.every(
      (food) =>
        food.culinary_intent.validation_status === "not_publishable",
    ),
    "Los registros ocultos o en cuarentena deben quedar marcados como no publicables",
  );
  assert.strictEqual(
    audit.totals.profiled_foods,
    audit.totals.visible_foods,
    "Todo alimento visible debe tener perfil de intención completo",
  );
  assert.strictEqual(
    audit.totals.incomplete_profiles,
    0,
    "No puede haber perfiles culinarios incompletos",
  );
  assert.strictEqual(
    audit.totals.unknown_contexts,
    0,
    "Premium 2.2 no debe dejar contextos técnicamente desconocidos",
  );
  assert(
    audit.totals.prompted_foods >= 450,
    `Cobertura adaptativa insuficiente: ${audit.totals.prompted_foods} alimentos`,
  );

  for (const testCase of CASES) {
    const origin = testCase.id
      ? engine.foods.find((food) => food.id === testCase.id)
      : findFood(engine.foods, testCase.query, testCase.aliases || []);
    assert(origin, `${testCase.name}: alimento de origen no localizado`);
    assert(
      visible(origin, engine.window),
      `${testCase.name}: alimento de origen no publicable`,
    );
    const prompt = engine.window.getPremiumUsagePrompt(origin, engine.foods);
    assert(prompt, `${testCase.name}: falta pregunta adaptativa`);
    assert.strictEqual(
      prompt.id,
      testCase.prompt,
      `${testCase.name}: plantilla de pregunta incorrecta`,
    );
    const available = prompt.options.map((option) => option.id);
    for (const option of testCase.expected) {
      assert(
        available.includes(option),
        `${testCase.name}: falta la modalidad ${option}`,
      );
      const result = await engine.calculate(origin, testCase.amount, {
        usageMode: option,
      });
      const all = [
        ...result.intercambios,
        ...result.familia,
        ...result.preparados,
      ];
      assert(all.length > 0, `${testCase.name}/${option}: sin alternativas`);
      for (const candidate of all) {
        assert(
          engine.window.getPremiumUsageCompatibility(candidate, option)
            .compatible,
          `${testCase.name}/${option}: alternativa incompatible ${candidate.name}`,
        );
      }
    }

    const signatures = [];
    for (const option of testCase.expected) {
      const result = await engine.calculate(origin, testCase.amount, {
        usageMode: option,
      });
      signatures.push(
        [
          ...result.intercambios.slice(0, 5),
          ...result.familia.slice(0, 5),
          ...result.preparados.slice(0, 5),
        ].map((candidate) => candidate.id).join(","),
      );
    }
    assert(
      new Set(signatures).size > 1,
      `${testCase.name}: la pregunta no cambia materialmente el TOP`,
    );
  }

  console.log(
    `PASS Premium 2.2 intent: ${audit.totals.profiled_foods}/${audit.totals.visible_foods} ` +
      `perfiles completos, ${audit.totals.prompted_foods} preguntas adaptativas, ` +
      `${CASES.length} familias verificadas`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
