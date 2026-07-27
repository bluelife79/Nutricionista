"use strict";

/**
 * Curated Premium 2.4 evidence for Spanish flavoured high-protein dairy.
 *
 * These rows already existed in the catalogue but were excluded because the
 * historical import did not retain their ingredient lists. The evidence below
 * comes from the current Open Food Facts API v2 record for each exact EAN.
 * Products are not promoted to "preferred": they remain compatible choices
 * with a visible sweetener/NOVA 4 explanation.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DB_PATH = path.join(ROOT, "database.json");

const CURATED = {
  "100077": {
    code: "8431876314519",
    name: "Postre proteína 0% fresa",
    brand: "Carrefour, Carrefour Sensation",
    source: "Carrefour",
    last_modified_t: 1773320025,
    nova_group: 4,
    nutriscore_grade: "a",
    additives_n: 3,
    sweeteners_n: 2,
    ingredients_text_es:
      "Leche desnatada pasteurizada, fresas (6%), almidón modificado, aromas, concentrado de zanahoria negra, edulcorantes: sucralosa y acesulfamo K, fermentos lácticos.",
    ingredients_analysis_tags: [
      "en:palm-oil-free",
      "en:non-vegan",
      "en:maybe-vegetarian",
    ],
    additives_tags: ["en:e14xx", "en:e950", "en:e955"],
    nutrients_100g: {
      added_sugars: 0,
      sugars: 3.7,
      saturated_fat: 0,
      salt: 0.1,
      fiber: 0,
    },
    use: "spoon",
  },
  "100089": {
    code: "8431876329988",
    name: "Yogur líquido sabor fresa proteína",
    brand: "Carrefour Sensation",
    source: "Carrefour",
    last_modified_t: 1781073906,
    nova_group: 4,
    nutriscore_grade: "c",
    additives_n: 2,
    sweeteners_n: 1,
    ingredients_text_es:
      "Leche desnatada pasteurizada, agua, proteínas de la leche, estabilizante: pectinas, aroma natural, zumo de zanahoria negra concentrado, edulcorante: sucralosa, zumo de limón concentrado, fermentos lácticos.",
    ingredients_analysis_tags: [
      "en:palm-oil-free",
      "en:non-vegan",
      "en:maybe-vegetarian",
    ],
    additives_tags: ["en:e440", "en:e955"],
    nutrients_100g: {
      added_sugars: 0,
      sugars: 4.6,
      saturated_fat: 0.2,
      salt: 0.11,
      fiber: 0,
    },
    use: "drink",
  },
  "100092": {
    code: "3560071226060",
    name: "Skyr fresa 0% M.G.",
    brand: "Carrefour",
    source: "Carrefour",
    last_modified_t: 1773320972,
    nova_group: 4,
    nutriscore_grade: "a",
    additives_n: 5,
    sweeteners_n: 2,
    ingredients_text_es:
      "Leche pasteurizada desnatada, fresas 8%, agua, almidón modificado de maíz, zumo concentrado de zanahoria, aroma natural, zumo concentrado de bayas de sauco, estabilizante: carragenanos, edulcorantes: acesulfamo K, sucralosa, correctores de acidez: ácido cítrico, citratos de sodio, fermentos lácticos.",
    ingredients_analysis_tags: [
      "en:palm-oil-free",
      "en:non-vegan",
      "en:maybe-vegetarian",
    ],
    additives_tags: ["en:e330", "en:e331", "en:e407", "en:e950", "en:e955"],
    nutrients_100g: {
      added_sugars: 0,
      sugars: 4.1,
      saturated_fat: 0.1,
      salt: 0.13,
      fiber: 0,
    },
    use: "spoon",
  },
};

function main() {
  const apply = process.argv.includes("--apply");
  const foods = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const updated = [];

  for (const food of foods) {
    const evidence = CURATED[String(food.id)];
    if (!evidence) continue;

    food.code = evidence.code;
    food.name = evidence.name;
    food.brand = evidence.brand;
    food.source = evidence.source;
    food.category = "dairy";
    food.subgroup = "high_protein_dairy";
    food.dairy_subfamily =
      evidence.use === "drink" ? "bebida_postre" : "frescos_proteicos";
    food.ready_to_eat = true;
    food.raw_ingredient = false;
    food.culinary_role = "meal_dish";
    food.frequency = "ocasional";
    food.processing_evidence = {
      version: "premium-v2.2-processing-1",
      status: "found",
      source: "Open Food Facts API v2",
      source_url:
        `https://world.openfoodfacts.org/api/v2/product/${evidence.code}`,
      restored_from_dump: null,
      raw_last_modified_t: evidence.last_modified_t,
      nova_group: evidence.nova_group,
      nutriscore_grade: evidence.nutriscore_grade,
      additives_n: evidence.additives_n,
      sweeteners_n: evidence.sweeteners_n,
      ingredients_n: evidence.ingredients_text_es
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean).length,
      ingredients_text_es: evidence.ingredients_text_es,
      ingredients_analysis_tags: evidence.ingredients_analysis_tags,
      additives_tags: evidence.additives_tags,
      categories_tags: [
        "en:dairies",
        "en:fermented-foods",
        "en:fermented-milk-products",
        "en:yogurts",
      ],
      food_groups_tags: ["en:milk-and-dairy-products", "en:milk-and-yogurt"],
      nutrient_levels: {},
      nutrients_100g: evidence.nutrients_100g,
      off_quality_status: "clean",
      off_quality_errors: [],
    };
    food.culinary_intent = {
      version: "premium-v2.3-intent-1",
      family: "fermented_dairy",
      uses: [evidence.use],
      primary_uses: [evidence.use],
      prompt_id: null,
      validated_modes: [],
      validation_status: "release_silent",
      validation_reasons: [
        "verified_flavoured_protein_dairy_single_use",
      ],
    };
    updated.push({
      id: food.id,
      code: food.code,
      name: food.name,
      use: evidence.use,
    });
  }

  if (updated.length !== Object.keys(CURATED).length) {
    throw new Error(
      `Expected ${Object.keys(CURATED).length} rows, updated ${updated.length}`,
    );
  }

  if (apply) {
    fs.writeFileSync(DB_PATH, `${JSON.stringify(foods, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ apply, updated }, null, 2));
}

main();
