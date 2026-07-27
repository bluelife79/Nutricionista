"use strict";

const assert = require("assert");
const { createProductHarness } = require("./lib/product_harness");

const AMOUNT_BY_CONTEXT = {
  breakfast_cereal: 40,
  bread: 60,
  dry_grain: 60,
  cooked_grain: 150,
  tuber: 200,
  cooked_tuber: 200,
  lean_meat: 120,
  fatty_meat: 120,
  minced_meat: 120,
  egg: 100,
  white_fish: 150,
  fatty_fish: 150,
  canned_fish: 80,
  seafood: 150,
  plant_protein: 120,
  cooked_legume: 150,
  milk: 200,
  plant_drink: 200,
  fermented_dairy: 125,
  fresh_cheese: 100,
  spoonable_fresh_dairy: 150,
  spreadable_cheese: 40,
  aged_cheese: 40,
  whole_fruit: 150,
  oil: 10,
  nuts_seeds: 20,
  avocado: 80,
  olive: 50,
  nut_spread: 20,
  plant_savory_spread: 40,
};

async function main() {
  const harness = createProductHarness();
  const core = harness.foods.filter(
    (food) =>
      harness.window.getPremiumExchangeScope(food).status === "exchange_core",
  );
  let withDirectExchange = 0;

  for (const origin of core) {
    const context = harness.window.inferPremiumContext(origin);
    const amount = AMOUNT_BY_CONTEXT[context] || 100;
    const result = await harness.calculate(origin, amount, {
      usageMode: "any",
    });
    const order = harness.window.getResultBlockOrder(origin, result);
    assert.deepStrictEqual(
      Array.from(order),
      ["intercambios", "preparados", "familia"],
      `Orden de bloques incorrecto para ${origin.name}`,
    );
    assert.strictEqual(
      harness.window.shouldShowFamilyFirst(origin, result),
      false,
      `Las marcas vuelven a preceder el intercambio para ${origin.name}`,
    );
    if (result.intercambios.length === 0) continue;
    withDirectExchange += 1;
    const expandable = harness.expandableScrollOrder(origin, result);
    assert(
      expandable.length > 0 && expandable[0]._block === "intercambios",
      `El primer resultado no es un intercambio real para ${origin.name}`,
    );
    const initial = harness.visibleResults(origin, result);
    assert(
      initial.slice(0, 3).some((candidate) => candidate._block === "intercambios"),
      `No hay ningún intercambio real entre las tres primeras tarjetas de ${origin.name}`,
    );
  }

  assert(core.length >= 1290, "La prueba visual no recorrió todo el núcleo");
  console.log(
    `PASS C1: 0/${core.length} orígenes con marcas delante; ` +
      `${withDirectExchange} con intercambio real verificado`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
