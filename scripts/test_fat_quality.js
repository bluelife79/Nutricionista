"use strict";

const assert = require("assert");
const { createProductHarness } = require("./lib/product_harness");

async function main() {
  const harness = createProductHarness();
  const publicFoods = harness.foods.filter((food) =>
    ["exchange_core", "reference_only"].includes(
      harness.window.getPremiumExchangeScope(food).status,
    ),
  );
  const excludedOil = harness.foods.filter(
    (food) =>
      /^aceite\b/i.test(food.name || "") &&
      /\b(palma|algod[oó]n|germen de trigo|para fre[ií]r)\b/i.test(food.name),
  );
  assert(excludedOil.length >= 4, "No se localizaron los aceites a excluir");
  assert(
    excludedOil.every(
      (food) =>
        harness.window.getPremiumExchangeScope(food).status === "excluded" ||
        harness.window.getPremiumExchangeScope(food).status ===
          "not_publishable",
    ),
    "Palma, algodón, germen de trigo o aceite para freír siguen publicables",
  );

  const seedOils = publicFoods.filter(
    (food) => food.fat_quality === "seed_refined",
  );
  assert(seedOils.length > 0, "Falta la clasificación de aceites de semillas");
  assert(
    seedOils.every(
      (food) =>
        harness.window.getPremiumChoiceGuidance(food).level !== "preferred",
    ),
    "Un aceite refinado o una conserva en ese aceite figura como prioritaria",
  );

  const canonicalAove = harness.foods.find(
    (food) => food.id === "bedca_0088",
  );
  assert(canonicalAove, "Falta el AOVE genérico de BEDCA");
  assert.strictEqual(
    harness.window.getPremiumExchangeScope(canonicalAove).status,
    "exchange_core",
    "El AOVE genérico de BEDCA no está publicado",
  );
  assert(
    harness.search("aove").some((food) => food.id === canonicalAove.id),
    "La búsqueda AOVE no recupera la referencia genérica",
  );

  const oliveOil = harness.foods.find((food) => food.id === "bedca_0081");
  const oliveResult = await harness.calculate(oliveOil, 10, {
    usageMode: "any",
  });
  assert(
    oliveResult.intercambios.slice(0, 3).every((candidate) =>
      ["avocado", "olive"].includes(candidate.fat_quality),
    ),
    "El aceite de oliva no abre con aguacate o aceitunas",
  );
  assert(
    oliveResult.familia
      .slice(0, 3)
      .every((candidate) => candidate.fat_quality === "olive"),
    "Otras variedades de oliva no lideran su bloque de aceites",
  );
  assert(
    oliveResult.intercambios
      .slice(0, 8)
      .every(
        (candidate) =>
          !["seed_refined", "tropical", "hydrogenated"].includes(
            candidate.fat_quality,
          ),
      ),
    "Un aceite refinado o tropical aparece arriba para aceite de oliva",
  );

  for (const origin of publicFoods.filter(
    (food) =>
      food.category === "fat" &&
      harness.window.getPremiumExchangeScope(food).status === "exchange_core",
  )) {
    const result = await harness.calculate(origin, 20, { usageMode: "any" });
    const visible = harness.expandableScrollOrder(origin, result);
    assert(
      visible.every(
        (candidate) =>
          !excludedOil.some(
            (excluded) => String(excluded.id) === String(candidate.id),
          ),
      ),
      `Aceite excluido visible desde ${origin.name}`,
    );
  }

  for (const originName of [
    "Salmón ahumado",
    "Mejillón, en conserva, al natural",
  ]) {
    const origin = harness.foods.find((food) => food.name === originName);
    assert(origin, `Falta caso de conserva ${originName}`);
    const result = await harness.calculate(origin, 100, { usageMode: "any" });
    assert(
      result.intercambios[0]?.fat_quality !== "seed_refined",
      `${originName} abre con una conserva en aceite de semillas`,
    );
  }

  console.log(
    `PASS C2: ${excludedOil.length} aceites fuera, ${seedOils.length} opciones ` +
      "de semillas sin prioridad y jerarquía de oliva verificada",
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
