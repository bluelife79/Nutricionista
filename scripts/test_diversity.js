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

function diversityKey(engine, food) {
  return `${food.subgroup || "unknown"}:${engine.window.inferPremiumContext(food)}`;
}

async function main() {
  const engine = createEngine();
  const core = engine.foods.filter(
    (food) =>
      engine.window.getPremiumExchangeScope(food).status === "exchange_core",
  );
  let monotypeTop5 = 0;
  let justifiedMonotype = 0;
  const violations = [];

  for (const origin of core) {
    const context = engine.window.inferPremiumContext(origin);
    const amount = AMOUNT_BY_CONTEXT[context] || 100;
    const result = await engine.calculate(origin, amount, { usageMode: "any" });
    const direct = result.intercambios || [];
    const top5 = direct.slice(0, 5);
    if (top5.length < 3) continue;

    const topKeys = top5.map((food) => diversityKey(engine, food));
    if (new Set(topKeys).size === 1) monotypeTop5 += 1;

    const counts = new Map();
    let foundComparableAlternative = false;
    for (const candidate of top5) {
      const key = diversityKey(engine, candidate);
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      if (count <= 2) continue;
      if (candidate.premiumDiversityPromoted === true) continue;

      const candidateTier =
        engine.context.presentationTier(candidate._sortScore).rank;
      const candidateQuality = Number(
        candidate.premiumOriginalSortScore ?? candidate._sortScore,
      );
      const alternative = direct.find(
        (food) =>
          !top5.some((visible) => visible.id === food.id) &&
          food.premiumIdentityRepeat !== true &&
          diversityKey(engine, food) !== key &&
          engine.context.presentationTier(food._sortScore).rank >=
            candidateTier &&
          Number(food.premiumOriginalSortScore ?? food._sortScore) >=
            candidateQuality * 0.9,
      );
      if (alternative) {
        foundComparableAlternative = true;
        violations.push(
          `${origin.name}: ${candidate.name} repite ${key}; ` +
            `${alternative.name} tenía calidad comparable`,
        );
      }
    }
    if (
      new Set(topKeys).size === 1 &&
      !foundComparableAlternative
    ) {
      justifiedMonotype += 1;
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `La diversidad relegó alternativas comparables: ${violations.slice(0, 12).join("; ")}`,
  );
  console.log(
    `PASS C8: 0 alternativas comparables relegadas; ${monotypeTop5} TOP 5 monotipo, ` +
      `${justifiedMonotype} sin otra opción de la misma banda de calidad`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
