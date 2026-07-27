"use strict";

const assert = require("assert");
const { createProductHarness } = require("./lib/product_harness");

const FOREIGN_LABEL =
  /\b(lapte|grasime|erdbeer|vanille|quarkzubereitung|geschmack|aromatizat|im stuck|greek style yogurt|strawberry|blueberry|passion fruit|amb|beguda|naturalny|noix|houmous|gaspacho|olives|quefir|with|and|milk|cheese|yogurt natural|macarrons|espirals|vegetals)\b/i;
const UNFRIENDLY = /\b(parte s\/e|parte sin especificar|\bs\/h\b)\b/i;
const HTML_ENTITY = /&(?:quot|amp|apos|#\d+);/i;

function main() {
  const harness = createProductHarness();
  const publicFoods = harness.foods.filter((food) =>
    ["exchange_core", "reference_only"].includes(
      harness.window.getPremiumExchangeScope(food).status,
    ),
  );
  const foreign = publicFoods.filter((food) => FOREIGN_LABEL.test(food.name));
  const unfriendly = publicFoods.filter((food) => UNFRIENDLY.test(food.name));
  const entities = publicFoods.filter((food) => HTML_ENTITY.test(food.name));

  assert.deepStrictEqual(
    foreign.map((food) => food.name),
    [],
    "Quedan nombres no castellanos en el catálogo publicable",
  );
  assert.deepStrictEqual(
    unfriendly.map((food) => food.name),
    [],
    "Quedan abreviaturas técnicas visibles para la clienta",
  );
  assert.deepStrictEqual(
    entities.map((food) => food.name),
    [],
    "Quedan entidades HTML impresas como texto en nombres publicables",
  );

  for (const id of [
    "off_331ba6d7c8",
    "off_87c46e784f",
    "off_37c05e2f90",
    "off_0538ad1d91",
  ]) {
    const food = harness.foods.find((item) => item.id === id);
    assert(food?.original_name, `${id}: falta trazabilidad del nombre original`);
    assert(
      (food.quality_reasons || []).includes(
        "premium_2_4_spanish_display_name",
      ),
      `${id}: falta la razón de normalización`,
    );
  }

  console.log(
    `PASS C11: ${publicFoods.length} nombres publicables sin etiquetas ` +
      "extranjeras, abreviaturas técnicas ni entidades HTML",
  );
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
