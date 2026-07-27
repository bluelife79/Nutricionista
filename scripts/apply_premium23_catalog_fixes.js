"use strict";

/**
 * High-confidence Premium 2.3 catalogue repairs.
 *
 * This script only changes identities that can be established from the name,
 * the existing source and the structured composition. It is idempotent and
 * intentionally does not bulk-import or unblock ambiguous Open Food Facts
 * products.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DB_PATH = path.join(ROOT, "database.json");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function addReason(food, reason) {
  if (!Array.isArray(food.quality_reasons)) food.quality_reasons = [];
  if (!food.quality_reasons.includes(reason)) {
    food.quality_reasons.push(reason);
  }
}

function removeFlag(food, flag) {
  if (!Array.isArray(food.flags)) return;
  food.flags = food.flags.filter((item) => item !== flag);
}

function addFlag(food, flag) {
  if (!Array.isArray(food.flags)) food.flags = [];
  if (!food.flags.includes(flag)) food.flags.push(flag);
}

function main() {
  const apply = process.argv.includes("--apply");
  const foods = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const stats = {
    spoonable_fresh_dairy: 0,
    spreadable_cheese: 0,
    plant_savory_spread: 0,
    nut_spread: 0,
    animal_spread_excluded: 0,
    seafood_corrected: 0,
    organ_or_blood_corrected: 0,
    french_omelette_corrected: 0,
    spanish_oil_names: 0,
    spanish_legacy_names: 0,
    bread_or_fish_oil_collisions: 0,
    obvious_identity_repairs: 0,
    avocado_corrected: 0,
    applied: apply,
  };

  for (const food of foods) {
    let name = normalize(food.name);

    if (String(food.id) === "100036") {
      if (!food.original_name) food.original_name = food.name;
      food.name = "Yogur ligero estilo griego";
      name = normalize(food.name);
      addReason(food, "premium_2_3_spanish_legacy_name");
      stats.spanish_legacy_names += 1;
    }

    if (food.id === "off_c7ea817d0a") {
      if (!food.original_name) food.original_name = food.name;
      food.name = "Filetes de caballa";
      name = normalize(food.name);
      addReason(food, "premium_2_3_spanish_legacy_name");
      stats.spanish_legacy_names += 1;
    }

    if (food.id === "off_16620aebd0") {
      food.category = "protein";
      food.subgroup = "processed_meat";
      food.premium_context = "processed_meat";
      food.macro_profile = "protein";
      addFlag(food, "prepared");
      addReason(food, "premium_2_3_ambiguous_commercial_turkey");
      stats.obvious_identity_repairs += 1;
      continue;
    }

    if (food.id === "off_2f23516647") {
      food.category = "dairy";
      food.subgroup = "aged_cheese";
      food.dairy_subfamily = "quesos_solidos";
      food.premium_context = "aged_cheese";
      food.macro_profile = "protein";
      addReason(food, "premium_2_3_solid_cheese_family");
      stats.obvious_identity_repairs += 1;
      continue;
    }

    if (food.id === "off_42ab06bd58") {
      food.category = "dairy";
      food.subgroup = "aged_cheese";
      food.dairy_subfamily = "quesos_solidos";
      food.premium_context = "aged_cheese";
      food.macro_profile = "protein";
      addReason(food, "premium_2_3_light_solid_cheese");
      stats.obvious_identity_repairs += 1;
      continue;
    }

    if (food.id === "off_49812bbb6f") {
      food.premium_context = "non_exchangeable";
      food.culinary_role = "recipe_ingredient";
      addReason(food, "premium_2_3_ambiguous_cheese_input");
      stats.obvious_identity_repairs += 1;
      continue;
    }

    if (/\bpan rallado\b/.test(name)) {
      food.category = "carbs";
      food.subgroup = "grains";
      food.premium_context = "baking_input";
      food.macro_profile = "carbs";
      food.culinary_role = "recipe_ingredient";
      addReason(food, "premium_2_3_breading_input");
      stats.obvious_identity_repairs += 1;
      continue;
    }

    if (
      /^(pan(?:ecill\w*)?|pico\w*|colin\w*|biscot\w*)\b/.test(name) &&
      !/\b(relleno|pizza|hamburguesa|bocadillo|sandwich)\b/.test(name)
    ) {
      food.category = "carbs";
      food.subgroup = "grains";
      food.premium_context = "bread";
      food.macro_profile = "carbs";
      food.culinary_role = "meal_dish";
      removeFlag(food, "condiment");
      addReason(food, "premium_2_3_bread_identity");
      stats.obvious_identity_repairs += 1;
      continue;
    }

    if (/\bpechuga de pollo en aceite\b/.test(name)) {
      food.category = "protein";
      food.subgroup = "meat_lean";
      food.premium_context = "lean_meat";
      food.macro_profile = "protein";
      food.culinary_role = "meal_dish";
      food.clean_protein = true;
      addFlag(food, "prepared");
      addReason(food, "premium_2_3_prepared_chicken_not_oil");
      stats.obvious_identity_repairs += 1;
      continue;
    }

    if (/\bqueso fresco batido\b/.test(name)) {
      removeFlag(food, "prepared");
      removeFlag(food, "condiment");
      food.category = "dairy";
      food.subgroup = "high_protein_dairy";
      food.dairy_subfamily = "lacteo_fresco_cuchara";
      food.premium_context = "spoonable_fresh_dairy";
      food.macro_profile = "protein";
      food.culinary_role = "meal_dish";
      food.ready_to_eat = true;
      addReason(food, "premium_2_3_spoonable_fresh_dairy");
      stats.spoonable_fresh_dairy += 1;
      continue;
    }

    if (
      /\b(queso (?:para )?untar|queso crema|crema de queso|frischkase)\b/.test(
        name,
      ) &&
      !/\b(salsa|tarta|rellen\w*|pizza)\b/.test(name)
    ) {
      removeFlag(food, "condiment");
      food.category = "dairy";
      food.subgroup = "fresh_cheese";
      food.dairy_subfamily = "queso_untable";
      food.premium_context = "spreadable_cheese";
      food.macro_profile = "protein";
      food.culinary_role = "meal_dish";
      food.ready_to_eat = true;
      addReason(food, "premium_2_3_spreadable_cheese");
      stats.spreadable_cheese += 1;
      continue;
    }

    if (/\b(hummus|houmous|guacamole)\b/.test(name)) {
      removeFlag(food, "condiment");
      food.category = "fat";
      food.subgroup = "other_fat";
      food.premium_context = "plant_savory_spread";
      food.macro_profile = "fat";
      food.culinary_role = "meal_dish";
      food.ready_to_eat = true;
      addReason(food, "premium_2_3_plant_savory_spread");
      stats.plant_savory_spread += 1;
      continue;
    }

    if (/\b(tahin\w*|pasta de sesamo)\b/.test(name)) {
      removeFlag(food, "prepared");
      removeFlag(food, "condiment");
      food.category = "fat";
      food.subgroup = "other_fat";
      food.premium_context = "nut_spread";
      food.macro_profile = "fat";
      food.culinary_role = "meal_dish";
      food.ready_to_eat = true;
      addReason(food, "premium_2_3_sesame_spread");
      stats.nut_spread += 1;
      continue;
    }

    if (/\b(zurrapa|sobrasad\w*|pate|foie)\b/.test(name)) {
      food.premium_context = "animal_savory_spread";
      food.category = "protein";
      food.subgroup = "processed_meat";
      food.macro_profile = "fat";
      food.culinary_role = "meal_dish";
      addReason(food, "premium_2_3_animal_spread_separated");
      stats.animal_spread_excluded += 1;
      continue;
    }

    if (/\bsangre\b/.test(name)) {
      food.premium_context = "non_exchangeable";
      food.category = "protein";
      food.subgroup = "viscera";
      food.frequency = "raro";
      food.exotic = true;
      addReason(food, "premium_2_3_blood_not_everyday_exchange");
      stats.organ_or_blood_corrected += 1;
      continue;
    }

    if (
        /\b(agujas?\b|sardina\w*|sardinilla\w*|atun\b|bonito\b|caballa\b|salmon\b|anchoa\w*|mejillon\w*|berberech\w*)\b/.test(
        name,
      ) &&
      /\b(aceite|lata|conserva|natural|escabeche)\b/.test(name)
    ) {
      food.category = "protein";
      food.subgroup = "fish_fatty";
      food.premium_context = "canned_fish";
      food.macro_profile = "protein";
      food.culinary_role = "meal_dish";
      food.clean_protein = true;
      removeFlag(food, "condiment");
      addReason(food, "premium_2_3_fish_oil_collision");
      stats.bread_or_fish_oil_collisions += 1;
      continue;
    }

    if (
      food.category === "protein" &&
      /\b(camaron\w*|gamba\w*|gambon\w*|langostin\w*|mejillon\w*|almeja\w*|berberech\w*|pulpo\w*|pota\b|calamar\w*|sepia\w*|vieira\w*|zamburin\w*|cangrej\w*|bogavante\w*|cigala\w*|centoll\w*|necora\w*|percebe\w*)\b/.test(
        name,
      ) &&
      !/\b(rebozad\w*|empanad\w*|salsa|ensalada|paella)\b/.test(name)
    ) {
      food.subgroup = "seafood";
      food.premium_context = "seafood";
      food.macro_profile = "protein";
      addReason(food, "premium_2_3_seafood_identity");
      stats.seafood_corrected += 1;
      continue;
    }

    if (
      food.id === "bedca_0717" ||
      /\btortilla(?: a la)? francesa\b/.test(name)
    ) {
      food.category = "protein";
      food.subgroup = "eggs";
      food.premium_context = "egg";
      food.macro_profile = "protein";
      food.culinary_role = "meal_dish";
      food.ready_to_eat = true;
      addReason(food, "premium_2_3_french_omelette_identity");
      stats.french_omelette_corrected += 1;
      continue;
    }

    if (food.id === "off_09a6a8571e" || food.id === "off_2bf4da0205") {
      if (!food.original_name) food.original_name = food.name;
      food.name =
        food.id === "off_09a6a8571e"
          ? "Aceite de oliva virgen extra"
          : "Aceite de oliva";
      name = normalize(food.name);
      food.category = "fat";
      food.subgroup = "olive_oil";
      food.premium_context = "oil";
      food.macro_profile = "fat";
      food.culinary_role = "recipe_ingredient";
      removeFlag(food, "condiment");
      addReason(food, "premium_2_3_spanish_oil_name");
      stats.spanish_oil_names += 1;
      continue;
    }

    if (/\bpan\b.*\baceite\b|\baceite\b.*\bpan\b/.test(name)) {
      food.category = "carbs";
      food.subgroup = "grains";
      food.premium_context = "bread";
      food.macro_profile = "carbs";
      food.culinary_role = "meal_dish";
      removeFlag(food, "condiment");
      addReason(food, "premium_2_3_bread_oil_collision");
      stats.bread_or_fish_oil_collisions += 1;
      continue;
    }

    if (
      /\b(avocado|aguacate)\b/.test(name) &&
      !/\b(guacamole|hummus|ensalada|salsa)\b/.test(name)
    ) {
      if (/^hoss avocado$/.test(name)) {
        if (!food.original_name) food.original_name = food.name;
        food.name = "Aguacate Hass";
      }
      food.category = "fat";
      food.subgroup = "avocado";
      food.premium_context = "avocado";
      food.macro_profile = "fat";
      food.culinary_role = "meal_dish";
      removeFlag(food, "condiment");
      addReason(food, "premium_2_3_avocado_identity");
      stats.avocado_corrected += 1;
    }
  }

  if (apply) {
    fs.writeFileSync(DB_PATH, `${JSON.stringify(foods, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(stats, null, 2));
}

main();
