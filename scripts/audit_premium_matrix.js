"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  ROOT,
  createEngine,
  calculateCase,
  normalize,
} = require("./lib/algorithm_harness");

const matrix = require("./premium_matrix.json");
const servingPolicy = JSON.parse(
  fs.readFileSync(path.join(ROOT, "config", "serving_policy.json"), "utf8"),
);

const EXPECTED_GROUPS = {
  hidratos: 16,
  proteinas: 26,
  lacteos: 14,
  frutas: 13,
  verduras: 13,
  grasas: 10,
  dificiles: 8,
};

const FOREIGN_LABEL_RE =
  /\b(lapte|grasime|erdbeer|vanille|vanillae|cioccolat|fromage|joghurt|jogurt|quarkzubereitung|geschmack|aromatizat|emmentaler|im stuck|parmesan|parmigiano|formatge|semi curado queso)\b/;

function visible(food) {
  return Boolean(
    food &&
      food.quality_status !== "quarantine" &&
      !(food.flags || []).includes("hidden") &&
      food.subgroup &&
      food.subgroup !== "?",
  );
}

function top(result, block, limit = 5) {
  return (result[block] || []).slice(0, limit);
}

function findMetadataContradiction(food) {
  const name = normalize(food.name);
  const firstSentence = normalize(String(food.usage_es || "").split(/[.!?]/)[0]);
  if (!firstSentence) return null;
  if (
    food.subgroup === "eggs" &&
    /\b(caracol|molusco|pescado|marisco)\b/.test(firstSentence)
  ) {
    return "egg_described_as_other_animal";
  }
  if (
    ["fresh_cheese", "aged_cheese"].includes(food.subgroup) &&
    /\b(bebida|se bebe|vaso|leche fermentada)\b/.test(firstSentence)
  ) {
    return "cheese_described_as_drink";
  }
  if (
    food.category === "fruits" &&
    /\b(carne|pescado|marisco|queso|embutido)\b/.test(firstSentence)
  ) {
    return "fruit_described_as_other_food";
  }
  return null;
}

function portionFinding(testCase, origin, candidate, engine) {
  const context = engine.window.inferPremiumContext(candidate);
  const policy =
    servingPolicy.contexts[context] ||
    servingPolicy.contexts.unknown;
  const amount = Number(candidate.equivalentAmount);
  const multiplier = amount / Number(testCase.amount_g);
  let severity = null;

  if (
    amount > Number(policy.hard_max_g) ||
    amount < Number(servingPolicy.defaults.hard_min_g)
  ) {
    severity = "critical";
  } else if (
    amount > Number(policy.review_max_g) ||
    multiplier > Number(servingPolicy.defaults.review_multiplier)
  ) {
    severity = "review";
  }
  if (!severity) return null;
  return {
    severity,
    case_id: testCase.id,
    candidate_id: candidate.id,
    origin: origin.name,
    candidate: candidate.name,
    origin_amount_g: testCase.amount_g,
    equivalent_amount_g: amount,
    multiplier: Number(multiplier.toFixed(2)),
    context,
    review_max_g: policy.review_max_g,
    hard_max_g: policy.hard_max_g,
  };
}

async function runAudit() {
  assert.strictEqual(matrix.length, 100, "La matriz Premium debe contener 100 casos");
  const ids = new Set();
  const counts = {};
  for (const testCase of matrix) {
    assert(!ids.has(testCase.id), `ID duplicado: ${testCase.id}`);
    ids.add(testCase.id);
    counts[testCase.group] = (counts[testCase.group] || 0) + 1;
  }
  assert.deepStrictEqual(counts, EXPECTED_GROUPS, "Distribución de grupos incorrecta");

  const engine = createEngine();
  const report = {
    contract: "premium-v2",
    context_policy: engine.window.PREMIUM_CONTEXT_VERSION,
    serving_policy: servingPolicy.version,
    serving_policy_status: servingPolicy.status,
    totals: {
      cases: matrix.length,
      origins_found: 0,
      direct_cases_with_3_or_more: 0,
      critical_context_mismatches: 0,
      critical_portions: 0,
      portions_to_review: 0,
      metadata_contradictions: 0,
      foreign_labels_in_top5: 0,
      unverified_off_origins: 0,
      unverified_off_in_top5: 0,
    },
    coverage_gaps: [],
    context_mismatches: [],
    portion_findings: [],
    metadata_findings: [],
    foreign_label_findings: [],
    off_provenance_findings: [],
  };

  for (const testCase of matrix) {
    const { origin, result } = await calculateCase(engine, testCase);
    assert(origin, `${testCase.id}: origen ausente`);
    assert(visible(origin), `${testCase.id}: origen no publicable: ${origin.name}`);
    report.totals.origins_found += 1;
    if (
      normalize(origin.source) === "openfoodfacts" &&
      !["verified_core_es", "verified_spain_other"].includes(
        origin.market_provenance?.status,
      )
    ) {
      report.totals.unverified_off_origins += 1;
      report.off_provenance_findings.push({
        case_id: testCase.id,
        block: "origin",
        food_id: origin.id,
        food: origin.name,
        status: origin.market_provenance?.status || "missing",
      });
    }

    const allVisible = [
      ...top(result, "intercambios", 8),
      ...top(result, "familia", 8),
      ...top(result, "preparados", 8),
    ];
    const seen = new Set();
    for (const candidate of allVisible) {
      assert(visible(candidate), `${testCase.id}: resultado no publicable: ${candidate.name}`);
      assert(
        Number.isFinite(candidate.equivalentAmount) &&
          candidate.equivalentAmount >= 5 &&
          candidate.equivalentAmount <= 600,
        `${testCase.id}: cantidad inválida: ${candidate.name} ${candidate.equivalentAmount}`,
      );
      const key = `${candidate.id}:${candidate.tier || ""}`;
      assert(!seen.has(key), `${testCase.id}: duplicado visible: ${candidate.name}`);
      seen.add(key);
    }

    const direct = top(result, "intercambios", 8);
    if (testCase.mode === "direct" && direct.length >= 3) {
      report.totals.direct_cases_with_3_or_more += 1;
    }
    if (testCase.mode === "direct" && direct.length < 3) {
      report.coverage_gaps.push({
        case_id: testCase.id,
        origin: origin.name,
        direct_count: direct.length,
      });
    }

    for (const candidate of top(result, "intercambios", 5)) {
      const compatibility =
        engine.window.getPremiumContextCompatibility(origin, candidate);
      if (!compatibility.compatible) {
        report.context_mismatches.push({
          case_id: testCase.id,
          origin: origin.name,
          candidate: candidate.name,
          origin_context: compatibility.origin,
          candidate_context: compatibility.candidate,
        });
      }

      const portion = portionFinding(testCase, origin, candidate, engine);
      if (portion) report.portion_findings.push(portion);

      if (FOREIGN_LABEL_RE.test(normalize(candidate.name))) {
        report.foreign_label_findings.push({
          case_id: testCase.id,
          candidate: candidate.name,
          source: candidate.source,
        });
      }
      if (
        normalize(candidate.source) === "openfoodfacts" &&
        !["verified_core_es", "verified_spain_other"].includes(
          candidate.market_provenance?.status,
        )
      ) {
        report.off_provenance_findings.push({
          case_id: testCase.id,
          block: "intercambios_top5",
          food_id: candidate.id,
          food: candidate.name,
          status: candidate.market_provenance?.status || "missing",
        });
      }
    }

    for (const food of [origin, ...allVisible]) {
      const contradiction = findMetadataContradiction(food);
      if (contradiction) {
        report.metadata_findings.push({
          case_id: testCase.id,
          food_id: food.id,
          food: food.name,
          contradiction,
        });
      }
    }
  }

  report.context_mismatches = report.context_mismatches.filter(
    (item, index, items) =>
      items.findIndex(
        (other) =>
          other.case_id === item.case_id &&
          other.candidate === item.candidate,
      ) === index,
  );
  report.metadata_findings = report.metadata_findings.filter(
    (item, index, items) =>
      items.findIndex((other) => other.food_id === item.food_id) === index,
  );
  report.foreign_label_findings = report.foreign_label_findings.filter(
    (item, index, items) =>
      items.findIndex(
        (other) =>
          other.case_id === item.case_id &&
          other.candidate === item.candidate,
      ) === index,
  );
  report.off_provenance_findings = report.off_provenance_findings.filter(
    (item, index, items) =>
      items.findIndex(
        (other) =>
          other.case_id === item.case_id &&
          other.block === item.block &&
          other.food_id === item.food_id,
      ) === index,
  );

  report.totals.critical_context_mismatches = report.context_mismatches.length;
  report.totals.critical_portions = report.portion_findings.filter(
    (item) => item.severity === "critical",
  ).length;
  report.totals.portions_to_review = report.portion_findings.filter(
    (item) => item.severity === "review",
  ).length;
  report.totals.metadata_contradictions = report.metadata_findings.length;
  report.totals.foreign_labels_in_top5 = report.foreign_label_findings.length;
  report.totals.unverified_off_in_top5 = report.off_provenance_findings.filter(
    (item) => item.block === "intercambios_top5",
  ).length;

  return report;
}

if (require.main === module) {
  runAudit()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error(error.stack || error);
      process.exitCode = 1;
    });
}

module.exports = {
  EXPECTED_GROUPS,
  runAudit,
};
