"use strict";

const { createEngine } = require("./lib/algorithm_harness");

function visible(food) {
  return Boolean(
    food &&
      food.quality_status !== "quarantine" &&
      !(food.flags || []).includes("hidden") &&
      food.subgroup &&
      food.subgroup !== "?",
  );
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function runIntentAudit() {
  const engine = createEngine();
  const report = {
    version: engine.window.PREMIUM_INTENT_VERSION,
    totals: {
      visible_foods: 0,
      profiled_foods: 0,
      prompted_foods: 0,
      intentionally_silent_foods: 0,
      unknown_contexts: 0,
      non_exchangeable_contexts: 0,
      incomplete_profiles: 0,
    },
    by_context: {},
    by_family: {},
    by_prompt: {},
    examples: {
      prompted: [],
      non_exchangeable: [],
      incomplete_profiles: [],
    },
  };

  for (const food of engine.foods) {
    if (!visible(food)) continue;
    report.totals.visible_foods += 1;
    const context = engine.window.inferPremiumContext(food);
    const profile = engine.window.getPremiumIntentProfile(food);
    const prompt = engine.window.getPremiumUsagePrompt(food, engine.foods);
    increment(report.by_context, context);
    increment(report.by_family, profile.family || "missing");

    if (context === "unknown") report.totals.unknown_contexts += 1;
    if (context === "non_exchangeable") {
      report.totals.non_exchangeable_contexts += 1;
      if (report.examples.non_exchangeable.length < 60) {
        report.examples.non_exchangeable.push({
          id: food.id,
          name: food.name,
          source: food.source,
          category: food.category,
          subgroup: food.subgroup,
        });
      }
    }

    if (
      profile &&
      profile.family &&
      Array.isArray(profile.uses) &&
      profile.uses.length > 0
    ) {
      report.totals.profiled_foods += 1;
    } else {
      report.totals.incomplete_profiles += 1;
      if (report.examples.incomplete_profiles.length < 50) {
        report.examples.incomplete_profiles.push({
          id: food.id,
          name: food.name,
        });
      }
    }

    if (prompt) {
      report.totals.prompted_foods += 1;
      increment(report.by_prompt, prompt.id);
      if (report.examples.prompted.length < 80) {
        report.examples.prompted.push({
          id: food.id,
          name: food.name,
          source: food.source,
          prompt_id: prompt.id,
          options: prompt.options.map((option) => option.id),
        });
      }
    } else {
      report.totals.intentionally_silent_foods += 1;
    }
  }

  return report;
}

if (require.main === module) {
  console.log(JSON.stringify(runIntentAudit(), null, 2));
}

module.exports = { runIntentAudit };
