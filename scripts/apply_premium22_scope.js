"use strict";

/**
 * Materialise Premium 2.2 exchange scope for every catalogue row.
 *
 * The stored decision makes the browser serve the exact policy that was
 * audited. Run without --apply for a read-only report.
 */

const fs = require("fs");
const path = require("path");
const { ROOT, createEngine } = require("./lib/algorithm_harness");

const DB_PATH = path.join(ROOT, "database.json");

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function main() {
  const apply = process.argv.includes("--apply");
  const engine = createEngine();
  const report = {
    version: engine.window.PREMIUM_EXCHANGE_SCOPE_VERSION,
    total_foods: engine.foods.length,
    statuses: {},
    by_context: {},
    by_reason: {},
    evidence_statuses: {},
    examples: {},
    applied: apply,
  };

  for (const food of engine.foods) {
    const context = engine.window.inferPremiumContext(food);
    const decision = engine.window.derivePremiumExchangeScope(food, context);
    food.exchange_scope = {
      version: decision.version,
      status: decision.status,
      reason_codes: Array.from(decision.reason_codes || []),
      context: decision.context,
      evidence_status: decision.evidence_status,
    };
    increment(report.statuses, decision.status);
    increment(report.by_context, `${decision.status}:${context}`);
    increment(report.evidence_statuses, decision.evidence_status);
    for (const reason of decision.reason_codes || []) {
      increment(report.by_reason, reason);
    }
    if (!report.examples[decision.status]) report.examples[decision.status] = [];
    if (report.examples[decision.status].length < 80) {
      report.examples[decision.status].push({
        id: food.id,
        name: food.name,
        source: food.source,
        context,
        reasons: decision.reason_codes,
        nova_group: food.processing_evidence?.nova_group ?? null,
      });
    }
  }

  if (apply) {
    fs.writeFileSync(
      DB_PATH,
      `${JSON.stringify(engine.foods, null, 2)}\n`,
      "utf8",
    );
  }
  console.log(JSON.stringify(report, null, 2));
}

main();
