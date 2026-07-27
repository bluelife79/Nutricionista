"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT, createEngine } = require("./lib/algorithm_harness");

const DB_PATH = path.join(ROOT, "database.json");

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function main() {
  const engine = createEngine();
  const report = {
    version: engine.window.PREMIUM_CHOICE_GUIDANCE_VERSION,
    levels: {},
    reasons: {},
  };

  for (const food of engine.foods) {
    const guidance = engine.window.derivePremiumChoiceGuidance(food);
    food.choice_guidance = {
      version: guidance.version,
      level: guidance.level,
      label: guidance.label,
      summary: guidance.summary,
      detail: guidance.detail,
      reason_codes: Array.from(guidance.reason_codes || []),
      rank_factor: guidance.rank_factor,
      no_added_sugar: guidance.no_added_sugar,
      nova_group: guidance.nova_group ?? null,
    };
    increment(report.levels, guidance.level);
    for (const reason of guidance.reason_codes || []) {
      increment(report.reasons, reason);
    }
  }

  fs.writeFileSync(DB_PATH, `${JSON.stringify(engine.foods, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main();
