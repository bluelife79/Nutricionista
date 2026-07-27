"use strict";

/**
 * Attach processing evidence from the local Open Food Facts JSONL dump to
 * every catalogue row with a barcode. The pass is streaming and never imports
 * products. It only enriches the 4,272 existing commercial records.
 *
 * Safe default: report only.
 *   node scripts/enrich_processing_evidence.js
 *   node scripts/enrich_processing_evidence.js --apply
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const DB_PATH = path.join(ROOT, "database.json");
const VERSION = "premium-v2.2-processing-1";
const SWEETENER_ADDITIVE_RE =
  /\b(en:)?e(950|951|952|954|955|957|959|960|961|962|964|965|966|967|968|969)\b/i;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return String(value)
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(values) {
  for (const value of values) {
    const number = finite(value);
    if (number != null) return number;
  }
  return null;
}

function limited(values, limit = 60) {
  return asArray(values).slice(0, limit);
}

function spanishIngredients(product) {
  const explicit = String(product.ingredients_text_es || "").trim();
  if (explicit) return explicit.slice(0, 1200);
  const language = String(product.lc || product.lang || "").toLowerCase();
  if (language === "es" || language.startsWith("es-")) {
    return String(product.ingredients_text || "").trim().slice(0, 1200) || null;
  }
  return null;
}

function extractEvidence(product, inputPath) {
  const nutriments = product.nutriments || {};
  const additives = limited(product.additives_tags, 40);
  const declaredSweeteners = firstFinite([
    product.ingredients_non_nutritive_sweeteners_n,
    product.ingredients_sweeteners_n,
  ]);
  const sweetenersFromAdditives = additives.filter((tag) =>
    SWEETENER_ADDITIVE_RE.test(String(tag)),
  ).length;
  const errors = [
    ...limited(product.data_quality_errors_tags, 30),
    ...limited(product.data_quality_bugs_tags, 30),
  ];

  return {
    version: VERSION,
    status: "found",
    restored_from_dump: path.basename(inputPath),
    raw_last_modified_t: finite(product.last_modified_t),
    nova_group: firstFinite([
      product.nova_group,
      nutriments["nova-group_100g"],
      nutriments["nova-group"],
    ]),
    nutriscore_grade:
      String(
        product.nutriscore_grade ||
          product.nutrition_grade_fr ||
          "",
      ).toLowerCase() || null,
    additives_n: firstFinite([product.additives_n, additives.length]),
    sweeteners_n:
      declaredSweeteners != null
        ? declaredSweeteners
        : sweetenersFromAdditives,
    ingredients_n: firstFinite([
      product.ingredients_n,
      Array.isArray(product.ingredients) ? product.ingredients.length : null,
    ]),
    ingredients_text_es: spanishIngredients(product),
    ingredients_analysis_tags: limited(
      product.ingredients_analysis_tags,
      30,
    ),
    additives_tags: additives,
    categories_tags: limited(product.categories_tags, 60),
    food_groups_tags: limited(product.food_groups_tags, 20),
    nutrient_levels: {
      fat: product.nutrient_levels?.fat || null,
      "saturated-fat":
        product.nutrient_levels?.["saturated-fat"] || null,
      sugars: product.nutrient_levels?.sugars || null,
      salt: product.nutrient_levels?.salt || null,
    },
    nutrients_100g: {
      sugars: firstFinite([
        nutriments.sugars_100g,
        nutriments.sugars,
      ]),
      saturated_fat: firstFinite([
        nutriments["saturated-fat_100g"],
        nutriments["saturated-fat"],
      ]),
      salt: firstFinite([nutriments.salt_100g, nutriments.salt]),
      fiber: firstFinite([
        nutriments.fiber_100g,
        nutriments.fibre_100g,
        nutriments.fiber,
        nutriments.fibre,
      ]),
    },
    off_quality_status: errors.length === 0 ? "clean" : "has_errors",
    off_quality_errors: errors,
  };
}

function parseArgs(argv) {
  const options = {
    input: path.join(ROOT, "..", "openfoodfacts-products.jsonl.gz"),
    apply: false,
    maxLines: Infinity,
    progressEvery: 250000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") options.input = path.resolve(argv[++index]);
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--max-lines") options.maxLines = Number(argv[++index]);
    else if (arg === "--progress-every") {
      options.progressEvery = Number(argv[++index]);
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }
  return options;
}

async function scan(options) {
  if (!fs.existsSync(options.input)) {
    throw new Error(`No existe el fichero OFF: ${options.input}`);
  }
  const foods = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const targets = new Map();
  for (const food of foods) {
    const code = String(food.code || "").trim();
    if (!code) continue;
    if (!targets.has(code)) targets.set(code, []);
    targets.get(code).push(food);
  }

  const stats = {
    version: VERSION,
    catalogue_rows: foods.length,
    rows_with_barcode: [...targets.values()].reduce(
      (sum, rows) => sum + rows.length,
      0,
    ),
    unique_target_codes: targets.size,
    dump_lines: 0,
    parsed_matches: 0,
    rows_enriched: 0,
    unmatched_codes: 0,
    evidence: {
      nova_known: 0,
      nova_4: 0,
      ingredients_es_known: 0,
      sweeteners_detected: 0,
      nutriscore_known: 0,
    },
    applied: options.apply,
  };

  const found = new Set();
  const stream = fs
    .createReadStream(options.input)
    .pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    stats.dump_lines += 1;
    if (stats.dump_lines > options.maxLines) {
      lines.close();
      stream.destroy();
      break;
    }
    const match = line.match(/"code"\s*:\s*"([^"]+)"/);
    if (!match || !targets.has(match[1]) || found.has(match[1])) {
      if (
        options.progressEvery > 0 &&
        stats.dump_lines % options.progressEvery === 0
      ) {
        console.error(
          `[processing-evidence] lines=${stats.dump_lines} ` +
            `matches=${found.size}/${targets.size}`,
        );
      }
      continue;
    }

    let product;
    try {
      product = JSON.parse(line);
    } catch {
      continue;
    }
    const evidence = extractEvidence(product, options.input);
    found.add(match[1]);
    stats.parsed_matches += 1;
    for (const food of targets.get(match[1])) {
      food.processing_evidence = evidence;
      stats.rows_enriched += 1;
      if (evidence.nova_group != null) stats.evidence.nova_known += 1;
      if (evidence.nova_group === 4) stats.evidence.nova_4 += 1;
      if (evidence.ingredients_text_es) {
        stats.evidence.ingredients_es_known += 1;
      }
      if (Number(evidence.sweeteners_n) > 0) {
        stats.evidence.sweeteners_detected += 1;
      }
      if (evidence.nutriscore_grade) {
        stats.evidence.nutriscore_known += 1;
      }
    }
    if (found.size === targets.size) {
      lines.close();
      stream.destroy();
      break;
    }
  }

  for (const [code, rows] of targets.entries()) {
    if (found.has(code)) continue;
    stats.unmatched_codes += 1;
    for (const food of rows) {
      food.processing_evidence = {
        version: VERSION,
        status: "raw_record_not_found",
        restored_from_dump: path.basename(options.input),
        nova_group: null,
        nutriscore_grade: null,
        sweeteners_n: null,
        ingredients_n: null,
        nutrient_levels: {},
      };
      stats.rows_enriched += 1;
    }
  }

  for (const food of foods) {
    if (String(food.code || "").trim()) continue;
    food.processing_evidence = {
      version: VERSION,
      status: "not_applicable",
      restored_from_dump: path.basename(options.input),
      nova_group: null,
      nutriscore_grade: null,
      sweeteners_n: null,
      ingredients_n: null,
      nutrient_levels: {},
    };
    stats.rows_enriched += 1;
  }

  if (options.apply) {
    fs.writeFileSync(DB_PATH, `${JSON.stringify(foods, null, 2)}\n`, "utf8");
  }
  return stats;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  scan(options)
    .then((stats) => console.log(JSON.stringify(stats, null, 2)))
    .catch((error) => {
      console.error(error.stack || error);
      process.exitCode = 1;
    });
}

module.exports = {
  VERSION,
  parseArgs,
  extractEvidence,
  scan,
};
