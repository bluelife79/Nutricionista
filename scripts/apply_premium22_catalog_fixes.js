"use strict";

/**
 * High-confidence data repairs found by the Premium 2.2 scope audit.
 *
 * The legacy "condiment" pass confused the Spanish word "soja" with soy
 * sauce. This script restores only identities that are explicit in the name
 * and structured category. Ambiguous soy desserts and cooking creams remain
 * excluded by the scope policy.
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

function addFlag(food, flag) {
  if (!Array.isArray(food.flags)) food.flags = [];
  if (!food.flags.includes(flag)) food.flags.push(flag);
}

function removeFlag(food, flag) {
  if (!Array.isArray(food.flags) || !food.flags.includes(flag)) return false;
  food.flags = food.flags.filter((item) => item !== flag);
  return true;
}

function addReason(food, reason) {
  if (!Array.isArray(food.quality_reasons)) food.quality_reasons = [];
  if (!food.quality_reasons.includes(reason)) food.quality_reasons.push(reason);
}

function main() {
  const apply = process.argv.includes("--apply");
  const foods = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const stats = {
    plain_oils_restored: 0,
    plant_drinks_restored: 0,
    plain_soy_foods_restored: 0,
    soy_flours_restored: 0,
    natural_soy_ferments_restored: 0,
    plain_soy_yogurts_restored: 0,
    plain_milks_restored: 0,
    false_plain_milk_labels_removed: 0,
    hummus_guacamole_restored: 0,
    plain_mozzarella_restored: 0,
    paella_ingredients_restored: 0,
    grain_products_restored: 0,
    olives_restored: 0,
    canned_fish_restored: 0,
    fish_viscera_restored: 0,
    bread_with_oil_restored: 0,
    tahini_restored: 0,
    composite_salads_restored: 0,
    instant_products_reclassified: 0,
    applied: apply,
  };

  for (const food of foods) {
    const name = normalize(food.name);

    if (
      Array.isArray(food.quality_reasons) &&
      food.quality_reasons.includes("premium_2_2_plain_milk_identity_restored") &&
      !/^(leche|llet|lait)\b/.test(name)
    ) {
      delete food.premium_context;
      addReason(food, "premium_2_2_false_plain_milk_label_removed");
      stats.false_plain_milk_labels_removed += 1;
    }

    if (
      food.category === "fat" &&
      ["olive_oil", "other_oils"].includes(food.subgroup) &&
      /\baceite\b/.test(name) &&
      !/\b(salsa|vinagreta|alino|aderezo)\b/.test(name)
    ) {
      const changed = removeFlag(food, "condiment");
      food.premium_context = "oil";
      food.culinary_role = "recipe_ingredient";
      addReason(food, "premium_2_2_plain_oil_not_condiment");
      if (changed) stats.plain_oils_restored += 1;
      continue;
    }

    if (
      /\b(leche|bebida|beguda)\b.*\bsoja\b|\bsoja\b.*\b(leche|bebida|beguda)\b/.test(
        name,
      ) &&
      !/\b(fresa|platano|vainilla|chocolate|cacao|cafe|batido)\b/.test(name)
    ) {
      const changed = removeFlag(food, "condiment");
      food.category = "dairy";
      food.subgroup = "other_dairy";
      food.dairy_subfamily = "bebida_vegetal";
      food.premium_context = "plant_drink";
      food.culinary_role = "staple";
      food.ready_to_eat = true;
      addReason(food, "premium_2_2_plain_soy_drink_restored");
      if (changed) stats.plant_drinks_restored += 1;
      continue;
    }

    if (
      /\bsoja\b/.test(name) &&
      /\b(seca|cruda|fresca|hervida|remojada|germinada|en conserva)\b/.test(
        name,
      ) &&
      !/\b(salsa|postre|crema|para cocinar)\b/.test(name)
    ) {
      const changed = removeFlag(food, "condiment");
      if (/\bgerminada\b/.test(name)) {
        food.category = "vegetables";
        food.subgroup = "other_veg";
        food.premium_context = "other_vegetable";
        food.macro_profile = "calories";
      } else {
        food.category = "carbs";
        food.subgroup = "legumes";
        food.premium_context = "cooked_legume";
        food.macro_profile = "protein";
      }
      food.culinary_role = "meal_dish";
      addReason(food, "premium_2_2_plain_soy_food_restored");
      if (changed) stats.plain_soy_foods_restored += 1;
      continue;
    }

    if (
      /\b(harina de soja|soja harina)\b/.test(name)
    ) {
      const changed = removeFlag(food, "condiment");
      food.category = "carbs";
      food.subgroup = "grains";
      food.premium_context = "baking_input";
      food.macro_profile = "carbs";
      food.culinary_role = "recipe_ingredient";
      addReason(food, "premium_2_2_soy_flour_restored");
      if (changed) stats.soy_flours_restored += 1;
      continue;
    }

    if (
      /\b(yogur|yogurt|postre)\b.*\bsoja\b|\bsoja\b.*\b(yogur|yogurt|postre)\b/.test(
        name,
      ) &&
      /\bnatural|nature\b/.test(name) &&
      !/\b(fresa|fruta|melocoton|vainilla|chocolate|cacao|naranja)\b/.test(
        name,
      )
    ) {
      const changed = removeFlag(food, "condiment");
      food.category = "dairy";
      food.subgroup = "whole_dairy";
      food.dairy_subfamily = "yogur_kefir";
      food.premium_context = "fermented_dairy";
      food.culinary_role = "meal_dish";
      food.ready_to_eat = true;
      addReason(food, "premium_2_2_natural_soy_ferment_restored");
      if (changed) stats.natural_soy_ferments_restored += 1;
      continue;
    }

    if (
      /\b(yogur|yogurt)\b.*\bsoja\b|\bsoja\b.*\b(yogur|yogurt)\b/.test(
        name,
      ) &&
      !/\b(fresa|fruta|melocoton|vainilla|chocolate|cacao|naranja|azucar|aromatizado)\b/.test(
        name,
      )
    ) {
      const changed = removeFlag(food, "condiment");
      food.category = "dairy";
      food.subgroup = "whole_dairy";
      food.dairy_subfamily = "yogur_kefir";
      food.premium_context = "fermented_dairy";
      food.culinary_role = "meal_dish";
      food.ready_to_eat = true;
      addReason(food, "premium_2_2_plain_soy_yogurt_restored");
      if (changed || food.id === "bedca_0162") {
        stats.plain_soy_yogurts_restored += 1;
      }
      continue;
    }

    if (
      /^(leche|llet|lait)\b/.test(name) &&
      !/\b(soja|avena|almendra|arroz|espelta|coco|trigo|yogur\w*|yogurt|kefir|quark|queso|mozzarella|nata|condensad\w*|evaporad\w*|polvo|fruta\w*|chocolate|cacao|fresa|vainilla|caramelo|fermentad\w*|l casei|crema de leche)\b/.test(
        name,
      )
    ) {
      removeFlag(food, "prepared");
      removeFlag(food, "condiment");
      food.category = "dairy";
      food.premium_context = "milk";
      food.culinary_role = "staple";
      food.ready_to_eat = true;
      addReason(food, "premium_2_2_plain_milk_identity_restored");
      stats.plain_milks_restored += 1;
      continue;
    }

    if (/\b(hummus|houmous|guacamole)\b/.test(name)) {
      const changed = removeFlag(food, "condiment");
      food.category = "fat";
      food.subgroup = "other_fat";
      food.premium_context = "savory_spread";
      food.macro_profile = "fat";
      food.culinary_role = "meal_dish";
      food.ready_to_eat = true;
      addReason(food, "premium_2_2_savory_spread_identity_restored");
      if (changed || food.premium_context !== "savory_spread") {
        stats.hummus_guacamole_restored += 1;
      } else {
        stats.hummus_guacamole_restored += 1;
      }
      continue;
    }

    if (
      /\b(mozzarella|mozzarela)\b/.test(name) &&
      !/\b(tortell\w*|pizza|lasa[nñ]\w*|pasta rellena|3 quesos|tres quesos)\b/.test(
        name,
      )
    ) {
      removeFlag(food, "prepared");
      food.category = "dairy";
      food.subgroup = "fresh_cheese";
      food.dairy_subfamily = "queso_fresco";
      food.premium_context = "fresh_cheese";
      food.macro_profile = "protein";
      food.culinary_role = "meal_dish";
      addReason(food, "premium_2_2_plain_mozzarella_restored");
      stats.plain_mozzarella_restored += 1;
      continue;
    }

    if (
      /\b(verdura|mezcla de verdura)\b.*\bpaella\b/.test(name)
    ) {
      removeFlag(food, "prepared");
      food.category = "vegetables";
      food.subgroup = "other_veg";
      food.premium_context = "other_vegetable";
      food.macro_profile = "calories";
      food.culinary_role = "meal_dish";
      addReason(food, "premium_2_2_paella_vegetable_identity_restored");
      stats.paella_ingredients_restored += 1;
      continue;
    }

    if (/^ensalada de\b/.test(name)) {
      addFlag(food, "prepared");
      removeFlag(food, "condiment");
      food.category = "other";
      food.subgroup = "other";
      food.premium_context = "prepared_meal";
      food.culinary_role = "meal_dish";
      food.ready_to_eat = true;
      addReason(food, "premium_2_2_composite_salad_restored");
      stats.composite_salads_restored += 1;
      continue;
    }

    if (
      /\barroz\b.*\b(especial )?paella\w*\b/.test(name) &&
      !/\b(paella marinera|paella preparada)\b/.test(name)
    ) {
      removeFlag(food, "prepared");
      food.category = "carbs";
      food.subgroup = "grains";
      food.premium_context =
        food.raw_ingredient === true ? "dry_grain" : "cooked_grain";
      food.macro_profile = "carbs";
      food.culinary_role = "meal_dish";
      addReason(food, "premium_2_2_paella_rice_identity_restored");
      stats.paella_ingredients_restored += 1;
      continue;
    }

    if (/\bpasta de sesamo\b/.test(name)) {
      removeFlag(food, "prepared");
      removeFlag(food, "condiment");
      food.category = "fat";
      food.subgroup = "other_fat";
      food.premium_context = "savory_spread";
      food.macro_profile = "fat";
      food.culinary_role = "recipe_ingredient";
      addReason(food, "premium_2_2_tahini_identity_restored");
      stats.grain_products_restored += 1;
      continue;
    }

    if (/\b(tahin\w*|tahina)\b/.test(name)) {
      removeFlag(food, "prepared");
      removeFlag(food, "condiment");
      food.category = "fat";
      food.subgroup = "other_fat";
      food.premium_context = "savory_spread";
      food.macro_profile = "fat";
      food.culinary_role = "recipe_ingredient";
      addReason(food, "premium_2_2_tahini_identity_restored");
      stats.tahini_restored += 1;
      continue;
    }

    if (
      /\bpasta alimenticia\b.*\bcon huevo\b/.test(name) &&
      !/\brellena\b/.test(name)
    ) {
      removeFlag(food, "prepared");
      food.category = "carbs";
      food.subgroup = "grains";
      food.premium_context =
        food.raw_ingredient === true ? "dry_grain" : "cooked_grain";
      food.macro_profile = "carbs";
      food.culinary_role = "meal_dish";
      addReason(food, "premium_2_2_egg_pasta_identity_restored");
      stats.grain_products_restored += 1;
      continue;
    }

    if (
      /\b(aceitun\w*|olives?)\b/.test(name) &&
      !/\b(mortadell\w*|mortadela\w*|pan|queso)\b/.test(name)
    ) {
      removeFlag(food, "prepared");
      removeFlag(food, "condiment");
      food.category = "fat";
      food.subgroup = "other_fat";
      food.premium_context = "olive";
      food.macro_profile = "fat";
      food.culinary_role = "meal_dish";
      addReason(food, "premium_2_2_olive_identity_restored");
      stats.olives_restored += 1;
      continue;
    }

    if (
      /\bhigado de (bacalao|pescado)\b/.test(name)
    ) {
      removeFlag(food, "prepared");
      removeFlag(food, "condiment");
      food.category = "protein";
      food.subgroup = "viscera";
      food.premium_context = "canned_fish";
      food.macro_profile = "protein";
      food.culinary_role = "meal_dish";
      addReason(food, "premium_2_2_fish_viscera_identity_restored");
      stats.fish_viscera_restored += 1;
      continue;
    }

    if (
      /\b(sardina\w*|sardinilla\w*|atun\b|bonito\b|caballa\b|salmon\b|bacalao\b|anchoa\w*|berberecho\w*|mejillon\w*)\b/.test(
        name,
      ) &&
      /\b(aceite|lata|conserva|natural|escabeche|ahumad\w*|anchoad\w*)\b/.test(
        name,
      )
    ) {
      removeFlag(food, "prepared");
      removeFlag(food, "condiment");
      food.category = "protein";
      food.subgroup = "fish_fatty";
      food.premium_context = "canned_fish";
      food.macro_profile = "protein";
      food.culinary_role = "meal_dish";
      addReason(food, "premium_2_2_preserved_fish_identity_restored");
      stats.canned_fish_restored += 1;
      continue;
    }

    if (
      /\bpan\b.*\baceite de oliva\b|\baceite de oliva\b.*\bpan\b/.test(name)
    ) {
      removeFlag(food, "prepared");
      removeFlag(food, "condiment");
      food.category = "carbs";
      food.subgroup = "bread";
      food.premium_context = "bread";
      food.macro_profile = "carbs";
      food.culinary_role = "meal_dish";
      addReason(food, "premium_2_2_bread_identity_restored");
      stats.bread_with_oil_restored += 1;
      continue;
    }

    if (["off_d344c623aa", "off_f8722b4d3f"].includes(food.id)) {
      addFlag(food, "prepared");
      removeFlag(food, "condiment");
      food.category = "other";
      food.subgroup = "other";
      food.premium_context = "prepared_meal";
      food.macro_profile = "carbs";
      food.clean_protein = false;
      food.culinary_role = "meal_dish";
      addReason(food, "premium_2_2_instant_noodles_excluded");
      stats.instant_products_reclassified += 1;
      continue;
    }

    if (["off_f36156f54b", "off_72befced23"].includes(food.id)) {
      addFlag(food, "condiment");
      food.category = "other";
      food.subgroup = "other";
      food.premium_context = "seasoning";
      food.macro_profile = "calories";
      food.clean_protein = false;
      food.culinary_role = "recipe_ingredient";
      addReason(food, "premium_2_2_bouillon_excluded");
      stats.instant_products_reclassified += 1;
    }
  }

  if (apply) {
    fs.writeFileSync(DB_PATH, `${JSON.stringify(foods, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(stats, null, 2));
}

main();
