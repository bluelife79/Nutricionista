"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ROOT, createEngine } = require("./lib/algorithm_harness");

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
  let cards = 0;

  for (const origin of core) {
    const context = engine.window.inferPremiumContext(origin);
    const amount = AMOUNT_BY_CONTEXT[context] || 100;
    const result = await engine.calculate(origin, amount, { usageMode: "any" });
    for (const block of ["intercambios", "familia", "preparados"]) {
      const visible = (result[block] || []).slice(0, 8);
      let previousRank = Infinity;
      for (const candidate of visible) {
        const tier = engine.context.presentationTier(candidate._sortScore);
        assert(
          tier.rank <= previousRank,
          `${origin.name}/${block}: ${tier.label} aparece después de una etiqueta inferior`,
        );
        previousRank = tier.rank;
        cards += 1;
      }
    }
  }

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const algorithm = fs.readFileSync(
    path.join(ROOT, "js", "algorithm.js"),
    "utf8",
  );
  assert(
    !/matchDisplay\s*\?\?|matchScore\}\s*%/.test(html),
    "La interfaz vuelve a mostrar un porcentaje de match",
  );
  assert(
    html.includes("window.presentationTier") &&
      algorithm.includes("Muy parecido") &&
      algorithm.includes("Buen cambio") &&
      algorithm.includes("Cambio posible"),
    "La interfaz no consume las tres etiquetas ordinales del motor",
  );

  console.log(
    `PASS C4: ${cards} tarjetas de ${core.length} orígenes con etiquetas monótonas y 0 porcentajes visibles`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
