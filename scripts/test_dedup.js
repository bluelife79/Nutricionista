"use strict";

const assert = require("assert");
const { createEngine } = require("./lib/algorithm_harness");

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
  const engine = createEngine();
  const core = engine.foods.filter(
    (food) =>
      engine.window.getPremiumExchangeScope(food).status === "exchange_core",
  );
  let originsWithAdjacentIdentity = 0;
  const examples = [];

  for (const origin of core) {
    const context = engine.window.inferPremiumContext(origin);
    const amount = AMOUNT_BY_CONTEXT[context] || 100;
    const result = await engine.calculate(origin, amount, { usageMode: "any" });
    const visible = (result.intercambios || []).slice(0, 5);
    let duplicate = false;
    for (let index = 1; index < visible.length; index += 1) {
      const previous = engine.context.clusterIngredientKey(visible[index - 1]);
      const current = engine.context.clusterIngredientKey(visible[index]);
      if (previous === current) {
        duplicate = true;
        if (examples.length < 12) {
          examples.push(
            `${origin.name}: ${visible[index - 1].name} / ${visible[index].name}`,
          );
        }
      }
    }
    if (duplicate) originsWithAdjacentIdentity += 1;
  }

  const ratio = originsWithAdjacentIdentity / Math.max(core.length, 1);
  assert(
    ratio < 0.02,
    `${originsWithAdjacentIdentity}/${core.length} orígenes con identidad repetida: ${examples.join("; ")}`,
  );

  const identity = (name) =>
    engine.context.clusterIngredientKey({
      id: name,
      name,
      category: "carbs",
      subgroup: "tubers",
    });
  assert.strictEqual(identity("Batata"), identity("Boniato"));

  console.log(
    `PASS C5: ${originsWithAdjacentIdentity}/${core.length} orígenes con duplicado de identidad adyacente`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
