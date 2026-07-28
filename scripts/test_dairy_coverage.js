"use strict";

const assert = require("assert");
const { createProductHarness } = require("./lib/product_harness");

async function main() {
  const harness = createProductHarness();
  const cases = [
    ["queso manchego", 30, 5],
    ["queso curado", 30, 5],
    ["queso semicurado", 30, 5],
    ["parmesano", 30, 5],
    ["queso en lonchas", 30, 5],
    ["cuajada", 125, 3],
    ["bebida de avena", 200, 3],
  ];

  for (const [query, amount, minimum] of cases) {
    const origin = harness.search(query)[0];
    assert(origin, `${query}: no se encuentra el origen`);
    const result = await harness.calculate(origin, amount, {
      usageMode: "any",
    });
    assert(
      result.intercambios.length >= minimum,
      `${query}: solo ofrece ${result.intercambios.length} intercambios reales`,
    );
  }

  const plantDrink = harness.search("bebida de avena")[0];
  const plantResults = await harness.calculate(plantDrink, 200, {
    usageMode: "any",
  });
  assert(
    plantResults.intercambios.some(
      (candidate) =>
        harness.window.inferPremiumContext(candidate) === "plant_drink",
    ),
    "La bebida de avena no ofrece otras bebidas vegetales como intercambio",
  );

  console.log(
    "PASS lácteos: quesos habituales, cuajada y bebidas vegetales con cobertura real",
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
