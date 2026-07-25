"use strict";

const fs = require("fs");
const path = require("path");
const {
  ROOT,
  createEngine,
  calculateCase,
} = require("./lib/algorithm_harness");

const SPEC_PATH = path.join(
  ROOT,
  "..",
  "ESPECIFICACION_CASOS_DORADOS_INTERCAMBIADOR_V2.json",
);
const OUTPUT_PATH = path.join(ROOT, "test_report_data.json");

async function main() {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const engine = createEngine();
  const generated = [];

  for (const testCase of spec.cases) {
    const { origin, result } = await calculateCase(engine, testCase);
    const top = (result.intercambios || []).slice(0, 8).map((food) => ({
      id: food.id,
      name: food.name,
      source: food.source,
      subgroup: food.subgroup,
      grams: Math.round(food.equivalentAmount || 0),
      match: food.matchDisplay ?? food.matchScore,
      score: Number((food._sortScore || 0).toFixed(4)),
    }));
    generated.push({
      id: testCase.id,
      query: testCase.query,
      amount_g: testCase.amount_g,
      baseline: testCase.baseline_2026_07_15,
      origin: {
        id: origin.id,
        name: origin.name,
        source: origin.source,
        category: origin.category,
        subgroup: origin.subgroup,
      },
      counts: {
        intercambios: (result.intercambios || []).length,
        familia: (result.familia || []).length,
        preparados: (result.preparados || []).length,
      },
      top,
      no_match: Boolean(result.noMatch),
    });
  }

  const report = {
    generated_at: new Date().toISOString(),
    database_count: engine.foods.length,
    llm_judge_enabled: false,
    generated,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2) + "\n");

  for (const item of generated) {
    console.log(
      `\n[${item.id}] ${item.origin.name} (${item.amount_g} g) ` +
        `— intercambio=${item.counts.intercambios}`,
    );
    item.top.forEach((food, index) => {
      console.log(
        `${String(index + 1).padStart(2)}. ${food.name} ` +
          `[${food.subgroup}; ${food.source}] ${food.grams} g`,
      );
    });
  }
  console.log(`\nInforme JSON: ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
