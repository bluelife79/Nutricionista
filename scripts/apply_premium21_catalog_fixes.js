"use strict";

/**
 * Premium 2.1 deterministic catalogue repair.
 *
 * This pass repairs only identities that are explicit in the product name and
 * quarantines labels that are too vague or internally contradictory. It never
 * guesses from macros alone. Run without --apply for a dry report.
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

function addReason(food, reason) {
  if (!Array.isArray(food.quality_reasons)) food.quality_reasons = [];
  if (!food.quality_reasons.includes(reason)) food.quality_reasons.push(reason);
}

function classify(food, category, subgroup, premiumContext, reason) {
  const before = [
    food.category,
    food.subgroup,
    food.premium_context || null,
  ].join("|");
  food.category = category;
  food.subgroup = subgroup;
  if (premiumContext) food.premium_context = premiumContext;
  food.premium_review_status = "premium_2_1_deterministic_identity";
  addReason(food, reason);
  return before !== [
    food.category,
    food.subgroup,
    food.premium_context || null,
  ].join("|");
}

function quarantine(food, reason) {
  const changed =
    food.quality_status !== "quarantine" ||
    !(food.flags || []).includes("hidden");
  food.quality_status = "quarantine";
  addFlag(food, "hidden");
  addReason(food, reason);
  food.premium_review_status = "blocked";
  return changed;
}

const TRANSLATIONS = {
  off_eebe9347a8: "Avena ecológica",
  off_190fdf36c7: "Leche desnatada UHT",
  off_8a4ee3ac2e: "Bebida ecológica de soja sabor vainilla",
  off_c69cbde4bb: "Harina de trigo",
  off_f56586b721: "Harina integral de espelta",
  off_78508ee044: "Harina de trigo tipo 55",
  off_2b6b55827b: "Filetes de salmón sin piel",
  off_8b659bf23e: "Mostaza a la antigua",
  off_14399b35f7: "Yogur natural",
  off_734d4ba9ff: "Yogur natural desnatado",
  off_eb0bf13b6a: "Salsa de tomate",
  off_0dfe80cfc6: "Ensaladilla rusa",
  off_1660cdbab2: "Gazpacho fresco",
  off_f81e88e713: "Bebida de arroz",
  off_23b6dbef2d: "Maíz para palomitas",
  off_05cdcbee68: "Cappuccino sabor avellana",
  off_93a87e02c2: "Fusilli ecológicos",
  off_768ff2b352: "Café espresso macchiato",
  off_967e121922: "Palitos de surimi",
  off_0ed17f30c4: "Lentejas con carne salada",
  off_9c02de8f0c: "Preparado de surimi Estrellas",
  off_2af4bb4660: "Pan",
  off_ac10b7df41: "Preparado de surimi",
  off_08900fa30c: "Yogur bebible de fresa",
  off_1b990150f6: "Mostaza francesa",
  off_3c262b308c: "Chalotas",
  off_57725e65cd: "Albóndigas",
  off_f1f90685ec: "Masa gruesa",
  off_e885808469: "Queso fresco cremoso Balance",
  off_61b09ba2b8: "Pepinos",
  off_7fcd9ccbef: "Hamburguesa vegetal Bert’s Deluxe",
  off_58fbcba533: "Palitos de queso",
  off_a42a3aa3de: "Crema agria",
  off_c589efdfed: "Dados de queso con ajo y finas hierbas",
};

const VAGUE_NAME_RE =
  /^(thai|stylesse frutos rojos|stylesse natural|koko s|duo glacier|wizzy crisp|nic nac|bike|maravilla|sabores|3 vegetales|exotico|sin lactosa|fibra baja en grasa|kaomix|kaomix xxl|petit|ensalight|marulas|elevation|deluxe|d7 especial|especial|special|clasicos classics|sabor cranberry|bravo nuss mischung|af energetica coviran|energetica coviran|coviran|vitalcol|anti oxidante|cold pressed|crecimiento a partir de 1 ano|pure clasico|linea sabores sin trozos 0|cuida t integrals|coctel tropical)$/;

const CONTRADICTORY_RE =
  /\bmiel de flores\b.*\bsalatbox\b|\bim stuck\b/;

function main() {
  const apply = process.argv.includes("--apply");
  const foods = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const stats = {
    translated_names: 0,
    fish_identity_repaired: 0,
    dairy_identity_repaired: 0,
    meat_identity_repaired: 0,
    plant_identity_repaired: 0,
    carb_identity_repaired: 0,
    prepared_identity_repaired: 0,
    sauce_identity_repaired: 0,
    ambiguous_quarantined: 0,
    targeted_identity_repaired: 0,
    intent_profiles_normalized: 0,
    applied: apply,
  };

  for (const food of foods) {
    if (
      food.culinary_intent &&
      Array.isArray(food.culinary_intent.uses) &&
      Array.isArray(food.culinary_intent.primary_uses)
    ) {
      const normalizedPrimary = food.culinary_intent.primary_uses.filter(
        (use) => food.culinary_intent.uses.includes(use),
      );
      if (
        normalizedPrimary.join("|") !==
        food.culinary_intent.primary_uses.join("|")
      ) {
        food.culinary_intent.primary_uses = normalizedPrimary;
        stats.intent_profiles_normalized += 1;
      }
    }

    if (TRANSLATIONS[food.id] && food.name !== TRANSLATIONS[food.id]) {
      if (!food.name_original) food.name_original = food.name;
      food.name = TRANSLATIONS[food.id];
      food.name_language = "es";
      food.name_review_status = "premium_2_1_deterministic_translation";
      stats.translated_names += 1;
    }

    const name = normalize(food.name);
    if (food.id === "off_015c5f3ca3") {
      if (quarantine(food, "product_identity_not_understandable_in_spain")) {
        stats.ambiguous_quarantined += 1;
      }
      continue;
    }
    if (food.id === "bedca_0142") {
      if (classify(
        food,
        "fat",
        "nuts_seeds",
        "nuts_seeds",
        "fried_legume_snack_is_fat_led",
      )) {
        stats.targeted_identity_repaired += 1;
      }
      food.macro_profile = "fat";
      food.culinary_role = "snack";
      food.frequency = "occasional";
      continue;
    }
    if (food.id === "off_43504095e6") {
      if (classify(
        food,
        "protein",
        "seafood",
        "canned_fish",
        "shellfish_preserved_ready_to_eat",
      )) {
        stats.targeted_identity_repaired += 1;
      }
      food.ready_to_eat = true;
      continue;
    }
    if (food.id === "off_4bcc821e09") {
      if (classify(
        food,
        "protein",
        "meat_fatty",
        "fatty_meat",
        "pork_neck_is_not_lean_meat",
      )) {
        stats.targeted_identity_repaired += 1;
      }
      food.macro_profile = "protein";
      continue;
    }
    if (food.id === "off_d344c623aa") {
      addFlag(food, "prepared");
      if (classify(
        food,
        "other",
        "other",
        "prepared_meal",
        "instant_noodle_dish_not_chicken",
      )) {
        stats.targeted_identity_repaired += 1;
      }
      food.macro_profile = "carbs";
      continue;
    }
    if (food.id === "off_72befced23") {
      addFlag(food, "condiment");
      if (classify(
        food,
        "other",
        "other",
        "seasoning",
        "stock_cube_is_seasoning_not_chicken",
      )) {
        stats.targeted_identity_repaired += 1;
      }
      food.macro_profile = "calories";
      food.culinary_role = "recipe_ingredient";
      continue;
    }
    if (food.id === "off_67461bcb55") {
      addFlag(food, "prepared");
      if (classify(
        food,
        "other",
        "other",
        "prepared_meal",
        "escalivada_is_prepared_vegetable_dish",
      )) {
        stats.targeted_identity_repaired += 1;
      }
      food.macro_profile = "calories";
      continue;
    }
    if (food.id === "off_6ed7f829c5") {
      addFlag(food, "condiment");
      if (classify(
        food,
        "other",
        "other",
        "savory_sauce",
        "cheese_sauce_is_sauce_not_cheese",
      )) {
        stats.targeted_identity_repaired += 1;
      }
      food.macro_profile = "calories";
      continue;
    }

    if (VAGUE_NAME_RE.test(name) || CONTRADICTORY_RE.test(name)) {
      if (quarantine(food, "ambiguous_or_contradictory_product_identity")) {
        stats.ambiguous_quarantined += 1;
      }
      continue;
    }

    if (food.id === "bedca_0044" || /\bpijota\b/.test(name)) {
      if (classify(
        food,
        "protein",
        "fish_white",
        "white_fish",
        "pijota_is_white_fish_not_dairy",
      )) {
        stats.fish_identity_repaired += 1;
      }
      food.clean_protein = true;
      food.dairy_subfamily = null;
      food.label_reason = "Pescado blanco magro identificado por BEDCA";
      food.usage_es_rejected = food.usage_es;
      food.usage_es = "Pescado blanco para plancha, horno o guiso.";
      food.usage_review_status = "premium_2_1_corrected";
      continue;
    }

    const prepared =
      /\b(ensaladilla|ensaladissima|ensalada completa|salteado|parrillada|relleno (de |para )?fajita\w*|noodles? sabor|poelee|truita|alb[oó]nd[ei]gas|pudin de pescado|cocktail oriental|coctel oriental|gildas|menestra|crema de setas|crema casera de pollo|lentejas con carne salada|ravioloni|crocanrol|poke|carne al estilo borgona|cuatro frutas con avena)\b/.test(name);
    if (prepared) {
      addFlag(food, "prepared");
      if (classify(
        food,
        "other",
        "other",
        "prepared_meal",
        "composite_prepared_food_name",
      )) {
        stats.prepared_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(gazpacho|gazpatxo)\b/.test(name)) {
      if (classify(food, "other", "cold_soup", "cold_soup", "cold_soup_name")) {
        stats.prepared_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(pana cotta|queso fresco.+(frut|fresa)|fromages frais aux fruits|quark frambuesa|fruta variada con queso fresco)\b/.test(name)) {
      if (classify(
        food,
        "other",
        "sweets_bakery",
        "sweet_dessert",
        "composite_dairy_dessert_name",
      )) {
        stats.prepared_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(sazonador pollo|sazonador de pollo)\b/.test(name)) {
      addFlag(food, "condiment");
      if (classify(food, "other", "other", "seasoning", "seasoning_name")) {
        stats.sauce_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(pate|zurrapa)\b/.test(name)) {
      if (classify(food, "fat", "other_fat", "savory_spread", "savory_meat_spread_name")) {
        stats.meat_identity_repaired += 1;
      }
      continue;
    }

    const ambiguousLegacyBucket =
      food.category === "other" ||
      [
        "other",
        "other_carbs",
        "other_dairy",
        "other_fat",
        "other_protein",
        "processed_protein",
        "cheese",
      ].includes(food.subgroup);
    if (!ambiguousLegacyBucket) continue;

    if (/\b(surimi|surumi|palitos? de surimi|palitos? de surumi|preparado de surimi|delicias? aguin\w*|estrellas aguin\w*|guliciosas|pecaditos del mar|divinas del mar|autenticas de aguin\w*)\b/.test(name)) {
      if (classify(
        food,
        "protein",
        "processed_protein",
        "processed_fish",
        "processed_fish_product_name",
      )) {
        stats.fish_identity_repaired += 1;
      }
      food.clean_protein = false;
      continue;
    }

    if (/\b(salmon|lachs)\b/.test(name)) {
      if (classify(food, "protein", "fish_fatty", "fatty_fish", "fatty_fish_name")) {
        stats.fish_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(gamba|vieira|poton|chipiron|calamar|sepia|mejillon)\w*\b/.test(name)) {
      if (classify(food, "protein", "seafood", "seafood", "seafood_name")) {
        stats.fish_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(york|jamon|chicharron)\b/.test(name)) {
      if (classify(
        food,
        "protein",
        "processed_meat",
        "processed_meat",
        "processed_meat_name",
      )) {
        stats.meat_identity_repaired += 1;
      }
      food.clean_protein = false;
      continue;
    }

    if (/\b(yogur|yoghurt|yaourt|yogourt|iogurt|bifidus|bidifus|biactive|l casei|quefir|kefir|fruchtzwerge|yughi)\b/.test(name)) {
      const subgroup = /\b(0|desnatad|light|maigre)\b/.test(name)
        ? "low_fat_dairy"
        : "whole_dairy";
      if (classify(
        food,
        "dairy",
        subgroup,
        "fermented_dairy",
        "fermented_dairy_name",
      )) {
        stats.dairy_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(bebida vegetal|bebida de (avena|aveia|soja|arroz|almendra|espelta|trigo espelta)|beguda d arros|bevanda .+ soia|coconut milk|leche de coco)\b/.test(name)) {
      if (classify(
        food,
        "dairy",
        "other_dairy",
        "plant_drink",
        "plant_drink_name",
      )) {
        stats.dairy_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(leche|lait|llet|preparado lacteo|preparaado lacteo|bebida lactea)\b/.test(name)) {
      const subgroup = /\b(desnatad|0 1|ecreme)\b/.test(name)
        ? "low_fat_dairy"
        : "whole_dairy";
      if (classify(food, "dairy", subgroup, "milk", "dairy_milk_name")) {
        stats.dairy_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(queso|quesitos|miniqueso|frischkase|fundente|especial fundir|sour cre)\b/.test(name)) {
      const fresh = /\b(crema|fresco|frischkase|sour cre)\b/.test(name);
      if (classify(
        food,
        "dairy",
        fresh ? "fresh_cheese" : "aged_cheese",
        fresh ? "fresh_cheese" : "aged_cheese",
        "cheese_name",
      )) {
        stats.dairy_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(altramuz|altramuc)\w*\b/.test(name)) {
      if (classify(food, "carbs", "legumes", "cooked_legume", "legume_name")) {
        stats.plant_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(pipas? ?de calabaza|pepitas? de frutos secos|cocktail tropical frutos secos)\b/.test(name)) {
      if (classify(food, "fat", "nuts_seeds", "nuts_seeds", "nut_or_seed_name")) {
        stats.plant_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(bechamel|mostaza|mostarde|moutarde|salsa|saus|vinagreta|mayonnaise|ali ?oli|houmous|hummus|tumaca|encurtidos|banderillas)\b/.test(name)) {
      addFlag(food, "condiment");
      if (classify(food, "other", "other", "savory_sauce", "sauce_or_condiment_name")) {
        stats.sauce_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(farine|farina|harina|masa gruesa)\b/.test(name)) {
      if (classify(food, "carbs", "grains", "baking_input", "flour_name")) {
        stats.carb_identity_repaired += 1;
      }
      food.raw_ingredient = true;
      food.culinary_role = "recipe_ingredient";
      continue;
    }

    if (/\b(pasta|macarr|espaguet|tallarin|fideo|fusill|fusili|penne|pajarita|trottole|coquillette|capellini|linguine|serpentini|fettuccini|espiral|radiatori|maccheroni|lumaconi|galets|casarecce|letras|lazos)\w*\b/.test(name)) {
      if (classify(food, "carbs", "grains", "dry_grain", "plain_pasta_name")) {
        stats.carb_identity_repaired += 1;
      }
      food.raw_ingredient = true;
      continue;
    }

    if (/\b(avena|copos de arroz|copos de trigo|blat de moro amb mel)\b/.test(name)) {
      if (classify(
        food,
        "carbs",
        "grains",
        "breakfast_cereal",
        "breakfast_cereal_name",
      )) {
        stats.carb_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(maiz para palomitas|mazorquitas)\b/.test(name)) {
      if (classify(food, "carbs", "grains", "dry_grain", "plain_maize_name")) {
        stats.carb_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(cappuccino|espresso macchiato|cafe espresso)\b/.test(name)) {
      if (classify(food, "other", "other", "hot_beverage", "coffee_drink_name")) {
        stats.prepared_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(proteindrink|proteinas)\b/.test(name)) {
      if (classify(
        food,
        "protein",
        "other_protein",
        "protein_supplement",
        "protein_supplement_name",
      )) {
        stats.plant_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(margarina|preparado culinario uht a base de grasa vegetal)\b/.test(name)) {
      if (classify(food, "fat", "butter_margarine", "oil", "spreadable_fat_name")) {
        stats.plant_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(cebollitas|chalotas|dientes de ajo)\b/.test(name)) {
      if (classify(
        food,
        "vegetables",
        "allium",
        "other_vegetable",
        "allium_vegetable_name",
      )) {
        stats.plant_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(almond dessert|cremoso limon)\b/.test(name)) {
      if (classify(
        food,
        "other",
        "sweets_bakery",
        "sweet_dessert",
        "dessert_name",
      )) {
        stats.prepared_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(memr?brillo|membrillo)\b/.test(name)) {
      if (classify(food, "other", "sweets_bakery", "sweet_spread", "sweet_spread_name")) {
        stats.prepared_identity_repaired += 1;
      }
      continue;
    }

    if (/\bsobras+ad\w*\b/.test(name)) {
      if (classify(food, "fat", "other_fat", "savory_spread", "savory_spread_name")) {
        stats.meat_identity_repaired += 1;
      }
      continue;
    }

    if (/\b(pan|pa torrat|bastonets? de pa|quadradets? de pa|toast|barra|regana|baguette|campero)\w*\b/.test(name)) {
      if (classify(food, "carbs", "grains", "bread", "bread_name")) {
        stats.carb_identity_repaired += 1;
      }
      continue;
    }
  }

  if (apply) {
    fs.writeFileSync(DB_PATH, `${JSON.stringify(foods, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(stats, null, 2));
}

main();
