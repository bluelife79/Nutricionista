"use strict";

const fs = require("fs");
const path = require("path");
const { createProductHarness } = require("./lib/product_harness");

const QUERY_FILE = path.join(
  __dirname,
  "..",
  "audit",
  "evidence",
  "v2_3_adversarial",
  "scripts",
  "queries.json",
);
const COOKED =
  /\b(cocid[oa]s?|hervid[oa]s?|asad[oa]s?|plancha|parrilla|frit[oa]s?|guisad[oa]s?|estofad[oa]s?|al\s+horno|al\s+vapor|escalfad[oa]s?|tostad[oa]s?|salteado|rehogad[oa]s?)\b/i;
const FOREIGN =
  /\b(amb|beguda|naturalny|noix|houmous|gaspacho|olives|quefir|tonyina|oli d oliva|with|and|milk|cheese|yogurt natural|macarrons|espirals|vegetals)\b/i;
const SEED_OIL =
  /aceite de (palma|algod[oó]n|germen|soja|girasol|colza|coco|ma[ií]z|s[eé]samo|lino|cacahuete|grano de uva|nuez)/i;
const AMOUNTS = {
  fats: [10, 15],
  fat: [10, 15],
  dairy: [125, 200],
  vegetables: [150, 250],
  fruits: [120, 200],
  protein: [100, 150],
  carbs: [60, 100],
  other: [60, 100],
};

function unique(values) {
  return Array.from(new Set(values));
}

async function runProductBaseline(options = {}) {
  const harness = createProductHarness(options);
  const queries = JSON.parse(fs.readFileSync(QUERY_FILE, "utf8"));
  const findings = {
    noSearch: [],
    familyFirst: [],
    tierInversion: [],
    unexplainedWeightBasis: [],
    identityRepeatTop5: [],
    largePortionUnnoticed: [],
    seedOilPreferred: [],
    foreign: [],
    zeroDirect: [],
    calorieCeilingViolation: [],
    cookedOrigin: [],
    uglyName: [],
  };
  let scenarios = 0;
  let cards = 0;
  let preferredCards = 0;
  let choiceWarningCards = 0;
  let weightBridgeCards = 0;

  for (const query of queries) {
    const searchResults = harness.search(query);
    if (searchResults.length === 0) {
      findings.noSearch.push(query);
      continue;
    }
    const origin = searchResults[0];
    const amounts = AMOUNTS[origin.category] || [70, 150];
    for (const amount of amounts) {
      const result = await harness.calculate(origin, amount, {
        usageMode: "any",
      });
      scenarios += 1;
      const visible = harness.expandableScrollOrder(origin, result);
      const top10 = visible.slice(0, 10);
      cards += top10.length;
      preferredCards += top10.filter(
        (candidate) =>
          candidate.premiumChoiceGuidance?.level === "preferred",
      ).length;
      choiceWarningCards += top10.filter((candidate) =>
        ["compatible", "unverified", "occasional"].includes(
          candidate.premiumChoiceGuidance?.level,
        ),
      ).length;
      weightBridgeCards += top10.filter(
        (candidate) => candidate.premiumWeightBasisBridge,
      ).length;

      if (result.intercambios.length === 0) {
        findings.zeroDirect.push(`${query}→${origin.name} (${amount}g)`);
      }
      if (
        harness.window.shouldShowFamilyFirst(origin, result) &&
        result.intercambios.length > 0
      ) {
        const directIndex = visible.findIndex(
          (candidate) => candidate._block === "intercambios",
        );
        findings.familyFirst.push(
          `${query}→${origin.name} (${amount}g): ${directIndex + 1}`,
        );
      }
      if (COOKED.test(origin.name)) {
        findings.cookedOrigin.push(`${query} → ${origin.name}`);
      }

      const tiers = top10.map(
        (candidate) =>
          harness.context.presentationTier(candidate._sortScore).rank,
      );
      for (let index = 0; index < tiers.length - 1; index += 1) {
        if (
          top10[index]._block === top10[index + 1]._block &&
          tiers[index] < tiers[index + 1]
        ) {
          findings.tierInversion.push(
            `${query}(${amount}g) #${index + 1}`,
          );
          break;
        }
      }

      for (const [index, candidate] of top10.slice(0, 5).entries()) {
        if (
          origin.weight_basis !== candidate.weight_basis &&
          !candidate.premiumWeightBasisBridge
        ) {
          findings.unexplainedWeightBasis.push(
            `${origin.name}(${amount}g) #${index + 1} → ${candidate.name}`,
          );
        }
        if (
          candidate.equivalentAmount >= 350 &&
          candidate.premiumPortionStatus !== "review"
        ) {
          findings.largePortionUnnoticed.push(
            `${origin.name}(${amount}g) #${index + 1} → ${candidate.name}`,
          );
        }
        if (
          SEED_OIL.test(candidate.name) &&
          candidate.premiumChoiceGuidance?.level === "preferred"
        ) {
          findings.seedOilPreferred.push(
            `${origin.name}(${amount}g) #${index + 1} → ${candidate.name}`,
          );
        }
        if (FOREIGN.test(candidate.name)) {
          findings.foreign.push(
            `${origin.name}(${amount}g) #${index + 1} → ${candidate.name}`,
          );
        }
        if (/\bs\/e\b|sin especificar|parte s\/e/i.test(candidate.name)) {
          findings.uglyName.push(
            `${origin.name} #${index + 1} → ${candidate.name}`,
          );
        }
        const originCalories = (origin.calories * amount) / 100 || 1;
        if (candidate.macros.calories > originCalories * 1.500001) {
          findings.calorieCeilingViolation.push(
            `${origin.name}(${amount}g) #${index + 1} → ${candidate.name}`,
          );
        }
        if (candidate.premiumIdentityRepeat === true) {
          findings.identityRepeatTop5.push(
            `${origin.name}(${amount}g) #${index + 1} → ${candidate.name}`,
          );
        }
      }
    }
  }

  const uniqueFindings = Object.fromEntries(
    Object.entries(findings).map(([key, value]) => [key, unique(value)]),
  );
  return {
    contract: "premium-v2.5-c13-baseline-1",
    provenance: harness.provenance,
    totals: {
      queries: queries.length,
      scenarios,
      cards,
      preferredCards,
      preferredPercentage: Number(
        ((preferredCards / Math.max(cards, 1)) * 100).toFixed(1),
      ),
      choiceWarningCards,
      weightBridgeCards,
      noSearch: uniqueFindings.noSearch.length,
      zeroDirect: uniqueFindings.zeroDirect.length,
      familyFirst: uniqueFindings.familyFirst.length,
      tierInversion: uniqueFindings.tierInversion.length,
      unexplainedWeightBasis:
        uniqueFindings.unexplainedWeightBasis.length,
      cookedOrigin: uniqueFindings.cookedOrigin.length,
      identityRepeatTop5: uniqueFindings.identityRepeatTop5.length,
      largePortionUnnoticed:
        uniqueFindings.largePortionUnnoticed.length,
      seedOilPreferred: uniqueFindings.seedOilPreferred.length,
      foreign: uniqueFindings.foreign.length,
      uglyName: uniqueFindings.uglyName.length,
      calorieCeilingViolation:
        uniqueFindings.calorieCeilingViolation.length,
    },
    findings: uniqueFindings,
  };
}

async function main() {
  const report = await runProductBaseline();
  const outputPath = process.argv[2];
  if (outputPath) {
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report.totals, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { runProductBaseline };
