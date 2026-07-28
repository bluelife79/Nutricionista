"use strict";

const assert = require("assert");
const { createEngine, normalize } = require("./lib/algorithm_harness");

const AMOUNT_BY_CONTEXT = {
  breakfast_cereal: 40,
  bread: 60,
  dry_grain: 60,
  cooked_grain: 150,
  tuber: 200,
  cooked_tuber: 200,
  lean_meat: 120,
  fatty_meat: 120,
  minced_meat: 120,
  egg: 100,
  white_fish: 150,
  fatty_fish: 150,
  canned_fish: 80,
  seafood: 150,
  plant_protein: 120,
  cooked_legume: 150,
  milk: 200,
  plant_drink: 200,
  fermented_dairy: 125,
  fresh_cheese: 100,
  spoonable_fresh_dairy: 150,
  spreadable_cheese: 40,
  aged_cheese: 40,
  whole_fruit: 150,
  leafy_vegetable: 150,
  cruciferous: 150,
  fruiting_vegetable: 150,
  root_vegetable: 150,
  stalk_vegetable: 150,
  other_vegetable: 150,
  oil: 10,
  nuts_seeds: 20,
  avocado: 80,
  olive: 50,
  nut_spread: 20,
  plant_savory_spread: 40,
  baking_input: 30,
  hot_beverage: 200,
};

const HARD_FORBIDDEN_RE =
  /\b(avecrem|yatekomo|zurrapa|sobrasad\w*|sangre\b|pate\b|foie\b|cubito de caldo)\b/;
const FOREIGN_LABEL_RE =
  /\b(lapte|grasime|erdbeer|vanille|quarkzubereitung|geschmack|aromatizat|im stuck|greek style yogurt|strawberry|blueberry|passion fruit)\b/;

function visibleScreen(result) {
  return [
    ...((result.intercambios || []).slice(0, 8)),
    ...((result.familia || []).slice(0, 8)),
    ...((result.preparados || []).slice(0, 8)),
  ];
}

function pushExample(target, value, limit = 40) {
  if (target.length < limit) target.push(value);
}

async function runExhaustiveAudit() {
  const engine = createEngine();
  const origins = engine.foods.filter(
    (food) =>
      engine.window.getPremiumExchangeScope(food).status === "exchange_core",
  );
  const report = {
    contract: "premium-v2.5-exhaustive",
    versions: {
      context: engine.window.PREMIUM_CONTEXT_VERSION,
      scope: engine.window.PREMIUM_EXCHANGE_SCOPE_VERSION,
      intent: engine.window.PREMIUM_INTENT_VERSION,
    },
    totals: {
      core_origins: origins.length,
      origins_with_results: 0,
      origins_with_3_or_more: 0,
      origins_with_6_or_more: 0,
      origins_with_direct_results: 0,
      critical_findings: 0,
      incompatible_direct_results: 0,
      invalid_portions: 0,
      ineligible_results: 0,
      hidden_results: 0,
      forbidden_results: 0,
      foreign_labels: 0,
      duplicate_results: 0,
    },
    by_context: {},
    examples: {
      no_results: [],
      fewer_than_3: [],
      incompatible: [],
      invalid_portions: [],
      ineligible: [],
      hidden: [],
      forbidden: [],
      foreign_labels: [],
      duplicates: [],
    },
  };

  for (const origin of origins) {
    const context = engine.window.inferPremiumContext(origin);
    const amount = AMOUNT_BY_CONTEXT[context] || 100;
    const result = await engine.calculate(origin, amount);
    const direct = (result.intercambios || []).slice(0, 8);
    const all = visibleScreen(result);
    const contextStats = report.by_context[context] ||= {
      origins: 0,
      with_results: 0,
      with_3_or_more: 0,
      with_6_or_more: 0,
      no_results: 0,
    };
    contextStats.origins += 1;

    if (all.length > 0) {
      report.totals.origins_with_results += 1;
      contextStats.with_results += 1;
    } else {
      contextStats.no_results += 1;
      pushExample(report.examples.no_results, {
        id: origin.id,
        name: origin.name,
        context,
      });
    }
    if (all.length >= 3) {
      report.totals.origins_with_3_or_more += 1;
      contextStats.with_3_or_more += 1;
    } else {
      pushExample(report.examples.fewer_than_3, {
        id: origin.id,
        name: origin.name,
        context,
        results: all.length,
      });
    }
    if (all.length >= 6) {
      report.totals.origins_with_6_or_more += 1;
      contextStats.with_6_or_more += 1;
    }
    if (direct.length > 0) report.totals.origins_with_direct_results += 1;

    const seen = new Set();
    for (const candidate of all) {
      const candidateKey = String(candidate.id);
      if (seen.has(candidateKey)) {
        report.totals.duplicate_results += 1;
        pushExample(report.examples.duplicates, {
          origin: origin.name,
          candidate: candidate.name,
        });
      }
      seen.add(candidateKey);

      const amountValue = Number(candidate.equivalentAmount);
      if (
        !Number.isFinite(amountValue) ||
        amountValue < 5 ||
        amountValue > 600
      ) {
        report.totals.invalid_portions += 1;
        pushExample(report.examples.invalid_portions, {
          origin: origin.name,
          candidate: candidate.name,
          amount: candidate.equivalentAmount,
        });
      }
      if (
        !engine.window.isPremiumExchangeCandidateEligible(candidate, origin)
      ) {
        report.totals.ineligible_results += 1;
        pushExample(report.examples.ineligible, {
          origin: origin.name,
          candidate: candidate.name,
        });
      }
      const guidance = engine.window.getPremiumChoiceGuidance(candidate);
      if (
        guidance.level === "hidden" ||
        engine.window.getPremiumExchangeScope(candidate).status === "excluded"
      ) {
        report.totals.hidden_results += 1;
        pushExample(report.examples.hidden, {
          origin: origin.name,
          candidate: candidate.name,
        });
      }
      const candidateName = normalize(candidate.name);
      if (HARD_FORBIDDEN_RE.test(candidateName)) {
        report.totals.forbidden_results += 1;
        pushExample(report.examples.forbidden, {
          origin: origin.name,
          candidate: candidate.name,
        });
      }
      if (FOREIGN_LABEL_RE.test(candidateName)) {
        report.totals.foreign_labels += 1;
        pushExample(report.examples.foreign_labels, {
          origin: origin.name,
          candidate: candidate.name,
        });
      }
    }

    for (const candidate of direct) {
      const compatibility =
        engine.window.getPremiumContextCompatibility(origin, candidate);
      if (!compatibility.compatible) {
        report.totals.incompatible_direct_results += 1;
        pushExample(report.examples.incompatible, {
          origin: origin.name,
          candidate: candidate.name,
          origin_context: compatibility.origin,
          candidate_context: compatibility.candidate,
        });
      }
    }
  }

  report.totals.critical_findings =
    report.totals.incompatible_direct_results +
    report.totals.invalid_portions +
    report.totals.ineligible_results +
    report.totals.hidden_results +
    report.totals.forbidden_results +
    report.totals.foreign_labels +
    report.totals.duplicate_results;

  return report;
}

async function main() {
  const report = await runExhaustiveAudit();
  assert(
    report.totals.core_origins >= 1250,
    `El núcleo quedó demasiado corto: ${report.totals.core_origins}`,
  );
  assert(
    report.totals.origins_with_results / report.totals.core_origins >= 0.99,
    "Menos del 99% del núcleo produce alguna alternativa",
  );
  assert(
    report.totals.origins_with_3_or_more / report.totals.core_origins >= 0.97,
    "Menos del 97% del núcleo produce tres alternativas",
  );
  // El bloqueo estricto entre pesos crudos y cocinados elimina resultados que
  // antes inflaban la cobertura. Conservamos un mínimo alto, pero nunca
  // reintroducimos un cruce engañoso solo para completar seis tarjetas.
  assert(
    report.totals.origins_with_6_or_more / report.totals.core_origins >= 0.935,
    "Menos del 93,5% del núcleo produce seis alternativas",
  );
  assert.strictEqual(
    report.totals.critical_findings,
    0,
    `La auditoría exhaustiva encontró riesgos: ${JSON.stringify(report.examples)}`,
  );
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { runExhaustiveAudit };
