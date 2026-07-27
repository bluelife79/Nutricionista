"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT } = require("./lib/algorithm_harness");
const { createProductHarness } = require("./lib/product_harness");

const DB_PATH = path.join(ROOT, "database.json");
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

function topSignature(result) {
  return (result.intercambios || [])
    .slice(0, 10)
    .map((candidate) => String(candidate.id))
    .join("|");
}

async function main() {
  const harness = createProductHarness();
  const publicStatuses = new Set(["exchange_core", "reference_only"]);
  const publicFoods = [];
  for (const food of harness.foods) {
    if (
      publicStatuses.has(
        harness.window.getPremiumExchangeScope(food).status,
      )
    ) {
      const storedIntent = food.culinary_intent || {};
      const candidatePromptId =
        storedIntent.prompt_id || storedIntent.suppressed_prompt_id;
      if (
        candidatePromptId &&
        ["release_silent", "release_candidate"].includes(
          storedIntent.validation_status,
        )
      ) {
        // Restore every candidate before calculating the first origin. The
        // runtime memoizes profiles while ranking candidates, so mutating one
        // food at a time would leave later foods cached as "silent".
        food.culinary_intent = {
          ...storedIntent,
          prompt_id: candidatePromptId,
          validation_status: "release_candidate",
          validated_modes: [],
        };
      }
      publicFoods.push(food);
      continue;
    }
    // Scope, quality and guidance evolve independently. Whenever one of
    // those layers removes a record from the published catalogue, invalidate
    // any previously approved prompt as part of the same deterministic gate.
    food.culinary_intent = {
      ...(food.culinary_intent || {}),
      prompt_id: null,
      validation_status: "not_publishable",
      validated_modes: [],
      validation_reasons: ["premium_2_4_scope_not_publishable"],
    };
  }
  const report = {
    evaluated: 0,
    kept: 0,
    silenced: 0,
    modesDropped: 0,
    reasons: {
      fewer_than_two_valid_modes: 0,
      no_material_top_change: 0,
    },
    examples: [],
  };

  for (const food of publicFoods) {
    const storedIntent = food.culinary_intent || {};
    const candidatePromptId =
      storedIntent.prompt_id || storedIntent.suppressed_prompt_id;
    if (!candidatePromptId) continue;
    const prompt = harness.window.getPremiumUsagePrompt(food, harness.foods);
    if (!prompt) {
      food.culinary_intent = {
        ...storedIntent,
        prompt_id: null,
        suppressed_prompt_id: candidatePromptId,
        validation_status: "release_silent",
        validated_modes: [],
      };
      continue;
    }
    report.evaluated += 1;
    const modes = prompt.options
      .map((option) => option.id)
      .filter((mode) => mode !== "any");
    const amount = AMOUNT_BY_PROMPT[prompt.id] || 100;
    const modeResults = [];
    for (const mode of modes) {
      const result = await harness.calculate(food, amount, {
        usageMode: mode,
      });
      const direct = result.intercambios || [];
      const compatibility = direct.map((candidate) =>
        harness.window
          .getPremiumUsageCompatibility(candidate, mode)
          .compatible,
      );
      const compatibleDirect = compatibility.filter(Boolean).length;
      const firstCompatible = compatibility[0] === true;
      let seenLessUsual = false;
      let monotonicCompatibility = true;
      for (const compatible of compatibility) {
        if (!compatible) {
          seenLessUsual = true;
        } else if (seenLessUsual) {
          monotonicCompatibility = false;
          break;
        }
      }
      modeResults.push({
        mode,
        direct: direct.length,
        compatibleDirect,
        firstCompatible,
        monotonicCompatibility,
        signature: topSignature(result),
      });
    }

    const validModeResults = modeResults.filter(
      (modeResult) =>
        modeResult.direct >= 5 &&
        modeResult.compatibleDirect >= 1 &&
        modeResult.firstCompatible &&
        modeResult.monotonicCompatibility,
    );
    const validModes = validModeResults.map(
      (modeResult) => modeResult.mode,
    );
    report.modesDropped += modes.length - validModes.length;
    const reasons = [];
    if (validModes.length < 2) {
      reasons.push("fewer_than_two_valid_modes");
    }
    if (
      validModes.length >= 2 &&
      new Set(
        validModeResults.map((modeResult) => modeResult.signature),
      ).size < 2
    ) {
      reasons.push("no_material_top_change");
    }
    if (reasons.length === 0) {
      const validatedIntent = {
        ...(food.culinary_intent || {}),
        prompt_id: prompt.id,
        validation_status: "release_validated",
        validated_modes: validModes,
        validation_reasons: ["premium_2_4_no_collapse_gate"],
      };
      delete validatedIntent.suppressed_prompt_id;
      food.culinary_intent = validatedIntent;
      report.kept += 1;
      continue;
    }

    const previousPrompt = food.culinary_intent?.prompt_id || prompt.id;
    food.culinary_intent = {
      ...(food.culinary_intent || {}),
      prompt_id: null,
      suppressed_prompt_id: previousPrompt,
      validation_status: "release_silent",
      validated_modes: [],
      validation_reasons: reasons,
    };
    report.silenced += 1;
    for (const reason of reasons) report.reasons[reason] += 1;
    if (report.examples.length < 80) {
      report.examples.push({
        id: food.id,
        name: food.name,
        prompt: prompt.id,
        modeResults,
        reasons,
      });
    }
  }

  fs.writeFileSync(
    DB_PATH,
    `${JSON.stringify(harness.foods, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
