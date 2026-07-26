"use strict";

const assert = require("assert");
const { createEngine } = require("./lib/algorithm_harness");

const REQUIRED_EXCLUDED_IDS = [
  "bedca_0017",
  "off_d344c623aa",
  "off_f8722b4d3f",
  "off_f36156f54b",
  "off_72befced23",
  "bedca_0026",
  "off_64b8ea3507",
  "off_354ba18376",
  "off_00932d34bc",
  "off_81bde75776",
  "off_a9e65f49ae",
  "off_58eef21385",
  "off_2e6c465bac",
  "off_5d25be94a2",
  "off_baa36240dc",
  "off_b283b94fc6",
  "off_4b2ce5dffb",
];

const CORE_CONTAMINATION_RE =
  /\b(yatekomo|avecrem|cubitos? de caldo|pastillas? de caldo|gominol\w*|golosin\w*|refresco\w*|bebida energet\w*|salchich\w*|choriz\w*|mortadela\w*|salami\w*|fuet\w*|nugget\w*|donuts?|croissants?|bolleria|galletas?|pudding|mousse|natillas?|sandwich\w*|sanwich\w*|pizza\w*|flautas?\b|conos? de vainilla|plum cake|tiras de maiz|aros de maiz|strawberr\w*|blueberr\w*|raspberr\w*|peach\w*|passion fruit|cottage cheese)\b/;

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function runScopeAudit() {
  const engine = createEngine();
  const report = {
    version: engine.window.PREMIUM_EXCHANGE_SCOPE_VERSION,
    totals: {
      foods: engine.foods.length,
      profiled: 0,
      exchange_core: 0,
      reference_only: 0,
      excluded: 0,
      not_publishable: 0,
      searchable: 0,
      candidate_eligible_for_core: 0,
      core_nova_4: 0,
      core_with_sweeteners: 0,
      core_name_contaminations: 0,
      excluded_required_missing: 0,
    },
    by_context: {},
    by_reason: {},
    findings: {
      core_nova_4: [],
      core_with_sweeteners: [],
      core_name_contaminations: [],
      required_exclusions: [],
    },
  };

  for (const food of engine.foods) {
    const scope = engine.window.getPremiumExchangeScope(food);
    if (
      scope &&
      scope.version === engine.window.PREMIUM_EXCHANGE_SCOPE_VERSION &&
      scope.status
    ) {
      report.totals.profiled += 1;
    }
    increment(report.totals, scope.status);
    increment(
      report.by_context,
      `${scope.status}:${engine.window.inferPremiumContext(food)}`,
    );
    for (const reason of scope.reason_codes || []) {
      increment(report.by_reason, reason);
    }
    if (engine.window.isPremiumExchangeSearchable(food)) {
      report.totals.searchable += 1;
    }
    if (
      scope.status === "exchange_core" &&
      engine.window.isPremiumExchangeCandidateEligible(food, {
        exchange_scope: {
          version: engine.window.PREMIUM_EXCHANGE_SCOPE_VERSION,
          status: "exchange_core",
          reason_codes: ["synthetic_core_origin"],
          context: "synthetic",
          evidence_status: "not_applicable",
        },
      })
    ) {
      report.totals.candidate_eligible_for_core += 1;
    }
    if (
      scope.status === "exchange_core" &&
      Number(food.processing_evidence?.nova_group) === 4
    ) {
      report.totals.core_nova_4 += 1;
      if (report.findings.core_nova_4.length < 100) {
        report.findings.core_nova_4.push({ id: food.id, name: food.name });
      }
    }
    if (
      scope.status === "exchange_core" &&
      Number(food.processing_evidence?.sweeteners_n) > 0
    ) {
      report.totals.core_with_sweeteners += 1;
      if (report.findings.core_with_sweeteners.length < 100) {
        report.findings.core_with_sweeteners.push({
          id: food.id,
          name: food.name,
        });
      }
    }
    if (
      scope.status === "exchange_core" &&
      CORE_CONTAMINATION_RE.test(normalize(food.name))
    ) {
      report.totals.core_name_contaminations += 1;
      if (report.findings.core_name_contaminations.length < 100) {
        report.findings.core_name_contaminations.push({
          id: food.id,
          name: food.name,
        });
      }
    }
  }

  for (const id of REQUIRED_EXCLUDED_IDS) {
    const food = engine.foods.find((item) => item.id === id);
    const status = food
      ? engine.window.getPremiumExchangeScope(food).status
      : "missing";
    report.findings.required_exclusions.push({
      id,
      name: food?.name || null,
      status,
    });
    if (status !== "excluded") {
      report.totals.excluded_required_missing += 1;
    }
  }
  return report;
}

if (require.main === module) {
  const report = runScopeAudit();
  assert.strictEqual(
    report.totals.profiled,
    report.totals.foods,
    "Todo registro debe tener alcance Premium 2.2",
  );
  assert.strictEqual(report.totals.core_nova_4, 0);
  assert.strictEqual(report.totals.core_with_sweeteners, 0);
  assert.strictEqual(report.totals.core_name_contaminations, 0);
  assert.strictEqual(report.totals.excluded_required_missing, 0);
  console.log(JSON.stringify(report, null, 2));
}

module.exports = { REQUIRED_EXCLUDED_IDS, runScopeAudit };
