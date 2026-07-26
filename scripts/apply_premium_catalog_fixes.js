"use strict";

/**
 * Deterministic Premium v2 catalogue pass.
 *
 * Every mutation is tied to an explicit, reviewable rule or ID. Generated
 * prose is never treated as evidence. Run without --apply for a dry report.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DB_PATH = path.join(ROOT, "database.json");

const SPANISH_NAMES = {
  off_ca9993c386: "Ensalada de quinoa",
  off_889461fffe: "Skyr para llevar sabor vainilla",
  off_42ee44f5ea: "Postre de soja sabor vainilla",
  off_8441bbdff9: "Queso fresco batido con frambuesa",
  off_62fb799126: "Queso fresco",
  off_de8dbb7aaf: "Yogur suave",
  off_42ab06bd58: "Queso light",
  off_7d4db8e77e: "Aceitunas verdes sin hueso",
  off_00228074b1: "Queso crema clásico",
  off_689d8d0523: "Skyr Ísey sabor vainilla",
  off_6fa511a7ee: "Zumo de manzana",
  off_d2671423c3: "Atún claro en escabeche",
};

const PREPARED_IDS = new Set([
  "bedca_0026",
  "bedca_0175",
  "bedca_0193",
  "bedca_0571",
  "off_2976191d97",
  "off_232a12fab9",
  "off_5fdba0a104",
  "off_c891b34dfe",
  "off_d1420d56a0",
  "off_efdc4bbb40",
  "off_36ad8edcc1",
  "off_940fa9fd46",
  "off_f41946bbbc",
  "off_b795842155",
  "off_314475952a",
  "off_6414010db5",
  "off_db537dfa9c",
  "off_5f04f839fd",
  "off_f0ba28c1b1",
  "off_549b48a632",
  "off_1813df487a",
  "off_361b79ed53",
  "off_4a08405c52",
  "off_78bafbc235",
  "off_dfab79280a",
  "off_e208270ed9",
  "off_b0924d9018",
  "off_7359b09328",
  "off_f24f435d68",
  "off_c001b2477c",
  "off_2fa1734d6f",
  "off_5c4962a933",
  "off_04c092dd4a",
  "off_96b60ed665",
  "off_2e5ec03a60",
  "off_ec9d0cfc8d",
  "off_d5d0097c5f",
  "off_08aa1b8b2c",
  "off_cb1f78aa12",
  "off_83257ae781",
  "off_ce58a8d7e6",
  "off_ce779e90c1",
  "off_64be6bbab3",
  "off_b7c8c11c30",
  "off_24133a69e5",
  "off_ca9993c386",
]);

const CONDIMENT_IDS = new Set([
  "off_98ffcc383c",
  "off_b2f3895eac",
]);

const QUARANTINE_IDS = new Set([
  "off_24c7f73836",
  "off_c8ffecf6cf",
  "off_bfd7ae7e11",
  "off_f34a696bb4",
  "off_5af92f0f27",
  "off_d482c3133a",
  "off_93df8b5690",
]);

const USAGE_QUARANTINE_IDS = new Set([
  "bedca_0054",
  "off_9d08e9fb91",
]);

const REJECTED_USAGE = {
  bedca_0054:
    "Caracol. Molusco raro en España, consumido guisado con salsa o al ajillo como plato en comidas festivas. Intercambio con mejillones o almejas.",
  off_9d08e9fb91:
    "Leche fermentada de cabra, consumo ocasional en España. Se bebe directa, exclusivamente en desayuno. Intercambio con kéfir de vaca o yogur natural de cabra.",
};

function addFlag(food, flag) {
  if (!Array.isArray(food.flags)) food.flags = [];
  if (!food.flags.includes(flag)) food.flags.push(flag);
}

function addReason(food, reason) {
  if (!Array.isArray(food.quality_reasons)) food.quality_reasons = [];
  if (!food.quality_reasons.includes(reason)) food.quality_reasons.push(reason);
}

function quarantine(food, reason) {
  food.quality_status = "quarantine";
  addFlag(food, "hidden");
  addReason(food, reason);
  food.premium_review_status = "blocked";
}

function main() {
  const apply = process.argv.includes("--apply");
  const foods = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const stats = {
    translated_names: 0,
    prepared_flags_added: 0,
    condiments_hidden: 0,
    vague_or_ambiguous_quarantined: 0,
    zero_macro_quarantined: 0,
    usage_metadata_quarantined: 0,
    off_out_of_scope_quarantined: 0,
    reclassified: 0,
    applied: apply,
  };

  for (const food of foods) {
    if (SPANISH_NAMES[food.id] && food.name !== SPANISH_NAMES[food.id]) {
      if (!food.name_original) food.name_original = food.name;
      food.name = SPANISH_NAMES[food.id];
      food.name_language = "es";
      food.name_review_status = "deterministic_translation";
      stats.translated_names += 1;
    }

    if (PREPARED_IDS.has(String(food.id))) {
      const before = Array.isArray(food.flags) && food.flags.includes("prepared");
      addFlag(food, "prepared");
      food.premium_context = "prepared_meal";
      food.premium_review_status = "deterministic_rule";
      if (!before) stats.prepared_flags_added += 1;
    }

    if (CONDIMENT_IDS.has(String(food.id))) {
      const before = Array.isArray(food.flags) && food.flags.includes("hidden");
      addFlag(food, "condiment");
      addFlag(food, "hidden");
      food.culinary_role = "recipe_ingredient";
      food.premium_review_status = "deterministic_rule";
      if (!before) stats.condiments_hidden += 1;
    }

    if (QUARANTINE_IDS.has(String(food.id))) {
      const before = food.quality_status === "quarantine";
      quarantine(food, "ambiguous_or_non_descriptive_name");
      if (!before) stats.vague_or_ambiguous_quarantined += 1;
    }

    const zeroOrInvalidMacros =
      !Number.isFinite(Number(food.calories)) ||
      Number(food.calories) <= 0 ||
      ["protein", "carbs", "fat"].some(
        (key) =>
          !Number.isFinite(Number(food[key])) ||
          Number(food[key]) < 0 ||
          Number(food[key]) > 100,
      );
    if (zeroOrInvalidMacros) {
      const before = food.quality_status === "quarantine";
      quarantine(food, "invalid_or_zero_exchange_macros");
      if (!before) stats.zero_macro_quarantined += 1;
    }

    if (
      String(food.source || "").toLowerCase() === "openfoodfacts" &&
      food.market_provenance &&
      !["verified_core_es", "verified_spain_other"].includes(
        food.market_provenance.status,
      )
    ) {
      const before = food.quality_status === "quarantine";
      quarantine(
        food,
        `off_market_gate:${food.market_provenance.status || "missing"}`,
      );
      if (!before) stats.off_out_of_scope_quarantined += 1;
    }

    if (USAGE_QUARANTINE_IDS.has(String(food.id))) {
      const before = food.usage_review_status === "quarantine";
      food.usage_es_rejected = REJECTED_USAGE[food.id];
      food.usage_es = null;
      food.usage_review_status = "quarantine";
      addReason(food, "generated_usage_contradicts_food_identity");
      if (!before) stats.usage_metadata_quarantined += 1;
    }

    if (food.id === "off_7359b09328") {
      food.category = "protein";
      food.subgroup = "fish_white";
      food.clean_protein = false;
      food.premium_context = "prepared_meal";
      food.premium_review_status = "deterministic_name_macro_rule";
      stats.reclassified += 1;
    }

    if (food.id === "off_d2671423c3") {
      food.category = "protein";
      food.subgroup = "fish_fatty";
      food.clean_protein = false;
      food.ready_to_eat = true;
      food.raw_ingredient = false;
      food.premium_context = "canned_fish";
      food.premium_review_status = "deterministic_name_macro_rule";
      stats.reclassified += 1;
    }

    if (food.id === "off_1bec267e34") {
      food.subgroup = "fresh_cheese";
      food.dairy_subfamily = "quesos_solidos";
      food.premium_context = "fresh_cheese";
      food.premium_review_status = "deterministic_name_macro_rule";
      stats.reclassified += 1;
    }
  }

  if (apply) {
    fs.writeFileSync(DB_PATH, `${JSON.stringify(foods, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(stats, null, 2));
}

main();
