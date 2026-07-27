"use strict";

const fs = require("fs");
const { createProductHarness } = require("./lib/product_harness");

const AMOUNT_BY_PROMPT = {
  cheese_use: 60,
  oats_use: 40,
  bread_use: 60,
  meat_use: 120,
  fish_use: 150,
  plant_protein_use: 100,
  legume_use: 150,
  tuber_use: 200,
  fermented_dairy_use: 125,
  vegetable_use: 150,
  spreadable_fat_use: 20,
};

function signature(items, limit = 10) {
  return items
    .slice(0, limit)
    .map((candidate) => String(candidate.id))
    .join("|");
}

async function runProductIntentAudit(options = {}) {
  const harness = createProductHarness(options);
  const publicFoods = harness.foods.filter((food) =>
    ["exchange_core", "reference_only"].includes(
      harness.window.getPremiumExchangeScope(food).status,
    ),
  );
  const report = {
    contract: "premium-v2.4-c13-intents-1",
    provenance: harness.provenance,
    totals: {
      publicOrigins: publicFoods.length,
      promptedOrigins: 0,
      optionScenarios: 0,
      zeroDirect: 0,
      fewerThanThreeDirect: 0,
      fewerThanAny: 0,
      promptsWithoutTop10Change: 0,
    },
    byPrompt: {},
    examples: {
      zeroDirect: [],
      fewerThanThreeDirect: [],
      promptsWithoutTop10Change: [],
    },
  };

  for (const origin of publicFoods) {
    const { prompt, modes } = harness.usageModesFor(origin);
    if (!prompt) continue;
    report.totals.promptedOrigins += 1;
    const optionModes = modes.filter((mode) => mode !== "any");
    const amount = AMOUNT_BY_PROMPT[prompt.id] || 100;
    const anyResult = await harness.calculate(origin, amount, {
      usageMode: "any",
    });
    const anyCount = anyResult.intercambios.length;
    const signatures = [];
    const promptStats = (report.byPrompt[prompt.id] ||= {
      origins: 0,
      scenarios: 0,
      zeroDirect: 0,
      fewerThanThreeDirect: 0,
    });
    promptStats.origins += 1;

    for (const usageMode of optionModes) {
      const result = await harness.calculate(origin, amount, { usageMode });
      const directCount = result.intercambios.length;
      const visible = harness.expandableScrollOrder(origin, result);
      signatures.push(signature(visible));
      report.totals.optionScenarios += 1;
      promptStats.scenarios += 1;

      if (directCount === 0) {
        report.totals.zeroDirect += 1;
        promptStats.zeroDirect += 1;
        if (report.examples.zeroDirect.length < 80) {
          report.examples.zeroDirect.push({
            origin: origin.name,
            prompt: prompt.id,
            usageMode,
          });
        }
      }
      if (directCount < 3) {
        report.totals.fewerThanThreeDirect += 1;
        promptStats.fewerThanThreeDirect += 1;
        if (report.examples.fewerThanThreeDirect.length < 80) {
          report.examples.fewerThanThreeDirect.push({
            origin: origin.name,
            prompt: prompt.id,
            usageMode,
            directCount,
          });
        }
      }
      if (directCount < anyCount) {
        report.totals.fewerThanAny += 1;
      }
    }

    if (
      signatures.length > 0 &&
      new Set(signatures).size === 1
    ) {
      report.totals.promptsWithoutTop10Change += 1;
      if (report.examples.promptsWithoutTop10Change.length < 80) {
        report.examples.promptsWithoutTop10Change.push({
          origin: origin.name,
          prompt: prompt.id,
        });
      }
    }
  }

  return report;
}

async function main() {
  const report = await runProductIntentAudit();
  const outputPath = process.argv[2];
  if (outputPath) {
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report.totals, null, 2));
  console.log(JSON.stringify(report.byPrompt, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { runProductIntentAudit };
