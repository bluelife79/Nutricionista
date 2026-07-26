"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const foods = JSON.parse(
  fs.readFileSync(path.join(ROOT, "database.json"), "utf8"),
);

const policySource = fs.readFileSync(
  path.join(ROOT, "js", "premium_policy.js"),
  "utf8",
);
const window = {};
const context = { window, globalThis: window };
vm.createContext(context);
vm.runInContext(policySource, context, { filename: "js/premium_policy.js" });

const CORE_RETAILERS = new Set(["mercadona", "carrefour", "lidl", "aldi"]);
const SPANISH_RETAILERS = new Set([
  ...CORE_RETAILERS,
  "dia",
  "eroski",
  "alcampo",
  "consum",
  "bonpreu",
  "el corte ingles",
]);
const PREPARED_RE =
  /\b(paella|lasan\w*|tortilla de patata|empanad\w*|pizza|croqueta\w*|risotto|ensalada|chili con carne|pasta\w* rellena\w*)\b/;
const FOREIGN_RE =
  /\b(lapte|grasime|erdbeer|vanille|cioccolat|fromage|joghurt|geschmack|aromatizat|green pitted olives|quinoa salad|cream cheese classic|suc de poma)\b/;
const VAGUE_RE =
  /^(light|natural|original|clasica|clasico|premium|energetica|antojos|hoymecuido|cocktail|tropical consum)$/;

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function visible(food) {
  return Boolean(
    food &&
      food.quality_status !== "quarantine" &&
      !(food.flags || []).includes("hidden") &&
      food.subgroup &&
      food.subgroup !== "?",
  );
}

function sourceClass(food) {
  const source = normalize(food.source);
  if (source === "bedca") return "bedca_canonical";
  if (CORE_RETAILERS.has(source)) return "core_spanish_retailer";
  if (SPANISH_RETAILERS.has(source)) return "other_spanish_retailer";
  if (source === "openfoodfacts") return "off_unverified";
  return "other";
}

function metadataContradictions(food) {
  const findings = [];
  const firstSentence = normalize(String(food.usage_es || "").split(/[.!?]/)[0]);
  const name = normalize(food.name);

  if (
    food.subgroup === "eggs" &&
    /\b(caracol|molusco|pescado|marisco)\b/.test(firstSentence)
  ) {
    findings.push("egg_described_as_other_animal");
  }
  if (
    ["fresh_cheese", "aged_cheese"].includes(food.subgroup) &&
    /\b(bebida|se bebe|vaso|leche fermentada)\b/.test(firstSentence)
  ) {
    findings.push("cheese_described_as_drink");
  }
  if (
    food.category === "fruits" &&
    /\b(carne|pescado|marisco|queso|embutido)\b/.test(firstSentence)
  ) {
    findings.push("fruit_described_as_other_food");
  }
  if (
    PREPARED_RE.test(name) &&
    !(food.flags || []).includes("prepared") &&
    !(food.flags || []).includes("condiment") &&
    !/\b(para ensalada|sazonador ensalada|especial paella)\b/.test(name) &&
    food.subgroup !== "cold_soup"
  ) {
    findings.push("prepared_name_without_flag");
  }
  if (VAGUE_RE.test(name)) findings.push("vague_name");
  return findings;
}

function runCatalogAudit() {
  const report = {
    totals: {
      foods: foods.length,
      visible: 0,
      quarantined_or_hidden: 0,
      off_records: 0,
      off_without_market_provenance: 0,
      visible_off_outside_market_gate: 0,
      foreign_visible_names: 0,
      metadata_contradictions: 0,
      unknown_premium_context: 0,
      invalid_core_macros: 0,
      visible_invalid_core_macros: 0,
    },
    by_source_class: {},
    findings: {
      off_without_market_provenance: [],
      foreign_visible_names: [],
      metadata_contradictions: [],
      unknown_premium_context: [],
      invalid_core_macros: [],
    },
  };

  for (const food of foods) {
    const isVisible = visible(food);
    if (isVisible) report.totals.visible += 1;
    else report.totals.quarantined_or_hidden += 1;

    const source = sourceClass(food);
    report.by_source_class[source] =
      (report.by_source_class[source] || 0) + 1;

    const macros = ["calories", "protein", "carbs", "fat"].map((key) =>
      Number(food[key]),
    );
    if (
      macros.some((value) => !Number.isFinite(value) || value < 0) ||
      Number(food.calories) <= 0 ||
      [food.protein, food.carbs, food.fat].some((value) => Number(value) > 100)
    ) {
      report.totals.invalid_core_macros += 1;
      if (isVisible) report.totals.visible_invalid_core_macros += 1;
      if (report.findings.invalid_core_macros.length < 30) {
        report.findings.invalid_core_macros.push({
          id: food.id,
          name: food.name,
          source: food.source,
          calories: food.calories,
          protein: food.protein,
          carbs: food.carbs,
          fat: food.fat,
        });
      }
    }

    if (normalize(food.source) === "openfoodfacts") {
      report.totals.off_records += 1;
      if (!food.market_provenance || food.market_provenance.market !== "ES") {
        report.totals.off_without_market_provenance += 1;
        if (report.findings.off_without_market_provenance.length < 30) {
          report.findings.off_without_market_provenance.push({
            id: food.id,
            code: food.code || null,
            name: food.name,
          });
        }
      }
      if (
        isVisible &&
        !["verified_core_es", "verified_spain_other"].includes(
          food.market_provenance?.status,
        )
      ) {
        report.totals.visible_off_outside_market_gate += 1;
      }
    }

    if (!isVisible) continue;
    const normalizedName = normalize(food.name);
    if (FOREIGN_RE.test(normalizedName)) {
      report.totals.foreign_visible_names += 1;
      if (report.findings.foreign_visible_names.length < 50) {
        report.findings.foreign_visible_names.push({
          id: food.id,
          name: food.name,
          source: food.source,
        });
      }
    }

    const contradictions = metadataContradictions(food);
    if (contradictions.length > 0) {
      report.totals.metadata_contradictions += contradictions.length;
      if (report.findings.metadata_contradictions.length < 100) {
        report.findings.metadata_contradictions.push({
          id: food.id,
          name: food.name,
          source: food.source,
          findings: contradictions,
          usage_es: food.usage_es || null,
        });
      }
    }

    const premiumContext = window.inferPremiumContext(food);
    if (premiumContext === "unknown") {
      report.totals.unknown_premium_context += 1;
      if (report.findings.unknown_premium_context.length < 50) {
        report.findings.unknown_premium_context.push({
          id: food.id,
          name: food.name,
          source: food.source,
          category: food.category,
          subgroup: food.subgroup,
          culinary_role: food.culinary_role,
        });
      }
    }
  }

  return report;
}

if (require.main === module) {
  console.log(JSON.stringify(runCatalogAudit(), null, 2));
}

module.exports = {
  runCatalogAudit,
};
