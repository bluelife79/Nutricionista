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
const RAW =
  /\b(crud[oa]s?|fresc[oa]s?|sin\s+cocer|en\s+seco|sec[oa]s?)\b/i;
const COOKED =
  /\b(cocid[oa]s?|hervid[oa]s?|asad[oa]s?|plancha|parrilla|frit[oa]s?|guisad[oa]s?|estofad[oa]s?|al\s+horno|al\s+vapor|escalfad[oa]s?|tostad[oa]s?|salteado|rehogad[oa]s?)\b/i;
const FOREIGN =
  /\b(amb|beguda|naturalny|noix|houmous|gaspacho|olives|quefir|with|and|milk|cheese|yogurt natural|macarrons|espirals|vegetals)\b/i;
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
    rawCooked: [],
    familyFirst: [],
    percentageInversion: [],
    adjacentMacroDuplicate: [],
    largePortion: [],
    seedOil: [],
    foreign: [],
    zeroReal: [],
    calorieDrift: [],
    cookedOrigin: [],
    uglyName: [],
    lowDiversity: [],
  };
  let scenarios = 0;
  let cards = 0;
  let preferredCards = 0;

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

      if (result.intercambios.length === 0) {
        findings.zeroReal.push(`${query}→${origin.name} (${amount}g)`);
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

      const percentages = top10.map((candidate) =>
        candidate.matchDisplay != null
          ? candidate.matchDisplay
          : candidate.matchScore,
      );
      for (let index = 0; index < percentages.length - 1; index += 1) {
        if (percentages[index] < percentages[index + 1] - 4) {
          findings.percentageInversion.push(
            `${query}(${amount}g) #${index + 1}`,
          );
          break;
        }
      }

      const originRaw = RAW.test(origin.name) && !COOKED.test(origin.name);
      const originCooked = COOKED.test(origin.name);
      for (const [index, candidate] of top10.slice(0, 5).entries()) {
        const candidateRaw =
          RAW.test(candidate.name) && !COOKED.test(candidate.name);
        const candidateCooked = COOKED.test(candidate.name);
        if (
          (originRaw && candidateCooked) ||
          (originCooked && candidateRaw)
        ) {
          findings.rawCooked.push(
            `${origin.name}(${amount}g) #${index + 1} → ${candidate.name}`,
          );
        }
        if (candidate.equivalentAmount >= 350) {
          findings.largePortion.push(
            `${origin.name}(${amount}g) #${index + 1} → ${candidate.name}`,
          );
        }
        if (SEED_OIL.test(candidate.name)) {
          findings.seedOil.push(
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
        if (candidate.macros.calories > originCalories * 1.35) {
          findings.calorieDrift.push(
            `${origin.name}(${amount}g) #${index + 1} → ${candidate.name}`,
          );
        }
      }

      for (let index = 0; index < Math.min(4, top10.length); index += 1) {
        const current = top10[index];
        const next = top10[index + 1];
        if (!next) break;
        if (
          Math.abs(current.protein - next.protein) < 0.2 &&
          Math.abs(current.carbs - next.carbs) < 0.2 &&
          Math.abs(current.fat - next.fat) < 0.2
        ) {
          findings.adjacentMacroDuplicate.push(
            `${origin.name}: #${index + 1} ${current.name} ≡ ${next.name}`,
          );
        }
      }

      const clusters = new Set(
        top10
          .slice(0, 5)
          .map(
            (candidate) =>
              `${candidate.subgroup || ""}|${candidate.premiumContext || ""}`,
          ),
      );
      if (clusters.size <= 1 && top10.length >= 5) {
        findings.lowDiversity.push(`${origin.name}(${amount}g)`);
      }
    }
  }

  const uniqueFindings = Object.fromEntries(
    Object.entries(findings).map(([key, value]) => [key, unique(value)]),
  );
  return {
    contract: "premium-v2.4-c13-baseline-1",
    provenance: harness.provenance,
    totals: {
      queries: queries.length,
      scenarios,
      cards,
      preferredCards,
      preferredPercentage: Number(
        ((preferredCards / Math.max(cards, 1)) * 100).toFixed(1),
      ),
      noSearch: uniqueFindings.noSearch.length,
      zeroReal: uniqueFindings.zeroReal.length,
      familyFirst: uniqueFindings.familyFirst.length,
      percentageInversion: uniqueFindings.percentageInversion.length,
      rawCooked: uniqueFindings.rawCooked.length,
      cookedOrigin: uniqueFindings.cookedOrigin.length,
      adjacentMacroDuplicate: uniqueFindings.adjacentMacroDuplicate.length,
      largePortion: uniqueFindings.largePortion.length,
      seedOil: uniqueFindings.seedOil.length,
      foreign: uniqueFindings.foreign.length,
      uglyName: uniqueFindings.uglyName.length,
      calorieDrift: uniqueFindings.calorieDrift.length,
      lowDiversity: uniqueFindings.lowDiversity.length,
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
