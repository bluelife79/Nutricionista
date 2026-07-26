"use strict";

/**
 * Exhaustive Premium 2.1 culinary-intent release audit.
 *
 * Every publishable food is profiled. Every mode that would be shown to a
 * user is executed through the real algorithm, not a scoring approximation.
 * With --apply, the validated profile and modes are embedded in database.json
 * so the browser serves exactly the audited decision.
 */

const fs = require("fs");
const path = require("path");
const { ROOT, createEngine } = require("./lib/algorithm_harness");

const DB_PATH = path.join(ROOT, "database.json");

function visible(food) {
  return Boolean(
    food &&
      food.quality_status !== "quarantine" &&
      !(food.flags || []).includes("hidden") &&
      food.subgroup &&
      food.subgroup !== "?",
  );
}

function amountFor(promptId) {
  return {
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
  }[promptId] || 100;
}

function signature(result) {
  return [
    ...result.intercambios.slice(0, 5),
    ...result.familia.slice(0, 5),
    ...result.preparados.slice(0, 5),
  ].map((candidate) => String(candidate.id)).join(",");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const engine = createEngine();
  const report = {
    version: engine.window.PREMIUM_INTENT_VERSION,
    total_foods: engine.foods.length,
    visible_foods: 0,
    profiled_foods: 0,
    prompted_foods_before_validation: 0,
    prompted_foods_release_validated: 0,
    intentionally_silent_foods: 0,
    modes_executed: 0,
    empty_modes: 0,
    incompatible_results: 0,
    prompts_without_material_change: 0,
    failures: [],
    by_prompt: {},
    applied: apply,
  };

  for (const food of engine.foods) {
    const foodProfile = engine.window.getPremiumIntentProfile(food);
    food.culinary_intent = {
      version: engine.window.PREMIUM_INTENT_VERSION,
      family: foodProfile.family,
      uses: Array.from(foodProfile.uses),
      primary_uses: Array.from(foodProfile.primary_uses),
      prompt_id: null,
      validated_modes: [],
      validation_status: visible(food)
        ? "release_silent"
        : "not_publishable",
    };
    report.profiled_foods += 1;
    if (visible(food)) report.visible_foods += 1;
  }

  const prompted = engine.foods
    .filter(visible)
    .map((food) => ({
      food,
      prompt: engine.window.getPremiumUsagePrompt(food, engine.foods),
    }))
    .filter((item) => item.prompt);
  report.prompted_foods_before_validation = prompted.length;

  for (let index = 0; index < prompted.length; index += 1) {
    const { food, prompt } = prompted[index];
    const modes = prompt.options.filter((option) => option.id !== "any");
    const validModes = [];
    const signatures = [];

    for (const mode of modes) {
      report.modes_executed += 1;
      const result = await engine.calculate(
        food,
        amountFor(prompt.id),
        { usageMode: mode.id },
      );
      const all = [
        ...result.intercambios,
        ...result.familia,
        ...result.preparados,
      ];
      if (all.length === 0) {
        report.empty_modes += 1;
        if (report.failures.length < 200) {
          report.failures.push({
            type: "empty_mode",
            id: food.id,
            name: food.name,
            prompt_id: prompt.id,
            mode: mode.id,
          });
        }
        continue;
      }
      const incompatible = all.filter(
        (candidate) =>
          !engine.window.getPremiumUsageCompatibility(candidate, mode.id)
            .compatible,
      );
      if (incompatible.length > 0) {
        report.incompatible_results += incompatible.length;
        if (report.failures.length < 200) {
          report.failures.push({
            type: "incompatible_result",
            id: food.id,
            name: food.name,
            prompt_id: prompt.id,
            mode: mode.id,
            candidates: incompatible.slice(0, 10).map((candidate) => ({
              id: candidate.id,
              name: candidate.name,
            })),
          });
        }
        continue;
      }
      validModes.push(mode.id);
      signatures.push(signature(result));
    }

    const materiallyDifferent = new Set(signatures).size >= 2;
    if (validModes.length >= 2 && materiallyDifferent) {
      food.culinary_intent.prompt_id = prompt.id;
      food.culinary_intent.validated_modes = validModes;
      food.culinary_intent.validation_status = "release_validated";
      report.prompted_foods_release_validated += 1;
      report.by_prompt[prompt.id] =
        (report.by_prompt[prompt.id] || 0) + 1;
    } else {
      food.culinary_intent.validation_status = "release_silent";
      report.intentionally_silent_foods += 1;
      if (validModes.length >= 2 && !materiallyDifferent) {
        report.prompts_without_material_change += 1;
      }
    }

    if ((index + 1) % 100 === 0 || index + 1 === prompted.length) {
      console.error(
        `[intent-audit] ${index + 1}/${prompted.length} alimentos; ` +
          `${report.modes_executed} modalidades`,
      );
    }
  }

  report.intentionally_silent_foods +=
    report.visible_foods - report.prompted_foods_before_validation;

  if (apply) {
    fs.writeFileSync(
      DB_PATH,
      `${JSON.stringify(engine.foods, null, 2)}\n`,
      "utf8",
    );
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
