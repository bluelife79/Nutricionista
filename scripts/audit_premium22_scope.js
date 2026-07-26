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
  "off_a9e65f49ae",
  "off_58eef21385",
  "off_2e6c465bac",
  "off_5d25be94a2",
  "off_baa36240dc",
  "off_b283b94fc6",
  "off_4b2ce5dffb",
];

const REQUIRED_COMPATIBLE_IDS = [
  "off_81042c6194",
  "off_a624b1851c",
  "off_f38f0e96a1",
  "off_00932d34bc",
];

const CORE_CONTAMINATION_RE =
  /\b(yatekomo|avecrem|cubitos? de caldo|pastillas? de caldo|gominol\w*|golosin\w*|refresco\w*|bebida energet\w*|salchich\w*|choriz\w*|mortadela\w*|salami\w*|fuet\w*|nugget\w*|donuts?|croissants?|bolleria|galletas?|pudding|mousse|natillas?|sandwich\w*|sanwich\w*|pizza\w*|flautas?\b|conos? de vainilla|plum cake|tiras de maiz|aros de maiz|cottage cheese)\b/;

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
      core_nova_4_without_guidance: 0,
      core_sweeteners_without_guidance: 0,
      core_with_added_sugar: 0,
      core_added_sugar_without_guidance: 0,
      core_without_choice_guidance: 0,
      compatible_choices: 0,
      core_name_contaminations: 0,
      excluded_required_missing: 0,
      compatible_required_missing: 0,
    },
    by_context: {},
    by_reason: {},
    findings: {
      core_nova_4: [],
      core_with_sweeteners: [],
      core_nova_4_without_guidance: [],
      core_sweeteners_without_guidance: [],
      core_with_added_sugar: [],
      core_added_sugar_without_guidance: [],
      core_without_choice_guidance: [],
      core_name_contaminations: [],
      required_exclusions: [],
      required_compatible: [],
    },
  };

  for (const food of engine.foods) {
    const scope = engine.window.getPremiumExchangeScope(food);
    const guidance = engine.window.getPremiumChoiceGuidance(food);
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
    if (guidance.level === "compatible") {
      report.totals.compatible_choices += 1;
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
      if (
        guidance.level !== "compatible" ||
        !(guidance.reason_codes || []).includes("nova_group_4")
      ) {
        report.totals.core_nova_4_without_guidance += 1;
        report.findings.core_nova_4_without_guidance.push({
          id: food.id,
          name: food.name,
          guidance,
        });
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
      if (
        guidance.level !== "compatible" ||
        !(guidance.reason_codes || []).includes("contains_sweeteners")
      ) {
        report.totals.core_sweeteners_without_guidance += 1;
        report.findings.core_sweeteners_without_guidance.push({
          id: food.id,
          name: food.name,
          guidance,
        });
      }
    }
    if (scope.status === "exchange_core") {
      const sugar = engine.window.getPremiumAddedSugarAssessment(food);
      if (sugar.status === "detected") {
        report.totals.core_with_added_sugar += 1;
        report.findings.core_with_added_sugar.push({
          id: food.id,
          name: food.name,
          sugar,
        });
        if (
          guidance.level !== "compatible" ||
          !(guidance.reason_codes || []).includes("contains_added_sugar")
        ) {
          report.totals.core_added_sugar_without_guidance += 1;
          report.findings.core_added_sugar_without_guidance.push({
            id: food.id,
            name: food.name,
            guidance,
          });
        }
      }
      if (
        !guidance ||
        guidance.version !== engine.window.PREMIUM_CHOICE_GUIDANCE_VERSION ||
        !["preferred", "compatible"].includes(guidance.level)
      ) {
        report.totals.core_without_choice_guidance += 1;
        report.findings.core_without_choice_guidance.push({
          id: food.id,
          name: food.name,
          guidance,
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
  for (const id of REQUIRED_COMPATIBLE_IDS) {
    const food = engine.foods.find((item) => item.id === id);
    const scope = food
      ? engine.window.getPremiumExchangeScope(food)
      : null;
    const guidance = food
      ? engine.window.getPremiumChoiceGuidance(food)
      : null;
    report.findings.required_compatible.push({
      id,
      name: food?.name || null,
      status: scope?.status || "missing",
      level: guidance?.level || "missing",
    });
    if (
      scope?.status !== "exchange_core" ||
      guidance?.level !== "compatible"
    ) {
      report.totals.compatible_required_missing += 1;
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
  assert(report.totals.core_nova_4 > 0);
  assert(report.totals.core_with_sweeteners > 0);
  assert.strictEqual(report.totals.core_nova_4_without_guidance, 0);
  assert.strictEqual(report.totals.core_sweeteners_without_guidance, 0);
  assert.strictEqual(report.totals.core_added_sugar_without_guidance, 0);
  assert.strictEqual(report.totals.core_without_choice_guidance, 0);
  assert.strictEqual(report.totals.core_name_contaminations, 0);
  assert.strictEqual(report.totals.excluded_required_missing, 0);
  assert.strictEqual(report.totals.compatible_required_missing, 0);
  console.log(JSON.stringify(report, null, 2));
}

module.exports = {
  REQUIRED_EXCLUDED_IDS,
  REQUIRED_COMPATIBLE_IDS,
  runScopeAudit,
};
