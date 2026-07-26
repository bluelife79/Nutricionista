"use strict";

/**
 * Reproducible Open Food Facts curator for the RevolucionaT catalogue.
 *
 * Default scope is intentionally narrow:
 *   - evidence of sale in Spain;
 *   - Mercadona, Carrefour, Lidl or Aldi;
 *   - Spanish product name;
 *   - complete core macros;
 *   - no OFF data-quality errors or critical nutrition warnings.
 *   - no NOVA 4, sweeteners or clearly ultra-processed product families.
 *
 * The output is a review queue, never a direct database.json mutation.
 *
 * Examples:
 *   node scripts/curate_off_spain.js --input ../openfoodfacts-products.jsonl.gz --stats-only
 *   node scripts/curate_off_spain.js --input ../openfoodfacts-products.jsonl.gz --output /tmp/off-spain.jsonl
 *   node scripts/curate_off_spain.js --input ../openfoodfacts-products.jsonl.gz --max-lines 100000
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const zlib = require("zlib");

const RETAILERS = {
  mercadona: [/\bmercadona\b/, /\bhacendado\b/, /\bbosque verde\b/, /\bdeliplus\b/],
  carrefour: [/\bcarrefour\b/],
  lidl: [/\blidl\b/],
  aldi: [/\baldi\b/],
};

const CRITICAL_WARNING_RE =
  /\b(nutrition-value-very-high|nutrition-data-per-100g-above|energy-value-in-kcal-does-not-match|nutrition-score-fruits-vegetables-nuts-estimate-from-ingredients-greater-than-100)\b/;

const SWEETENER_ADDITIVE_RE =
  /\be\s*(?:420|421|950|951|952|953|954|955|957|959|960|961|962|964|965|966|967|968|969)\b/;

const INDUSTRIAL_PRODUCT_RE =
  /\b(?:yatekomo|fideos? instantaneos?|noodles? instantaneos?|ramen instantaneo|cup noodles?|avecrem|pastillas? de caldo|cubitos? de caldo|caldo concentrado|bouillon|stock cubes?|refrescos?|bebidas? energeticas?|energy drinks?|nectar|zumos?|juices?|agua(?: mineral)?(?: natural)? sabor|patatas? fritas|chips|snacks? salados?|gominolas?|chuches|caramelos?|garrapinad[oa]s?|galletas?|cookies?|bolleria|donuts?|magdalenas?|croissants?|churros?|helados?|ice creams?|pizzas?|lasanas?|croquetas?|san jacobos?|canelones?|nuggets?|salchichon|chorizo|longaniza|mortadell?[ae]|salami|frankfurts?|salchichas?|bacon|beicon|jamon cocido|jamon curado|lomo embuchado|ketchup|mayonesa|salsa napolitana|mostaza|salsas? preparadas?|pates?)\b/;

const FOREIGN_LABEL_RE =
  /\b(?:stuffed|with|and|vine leaves?|forest fruit dessert|bamboo shoots?|seed mix|glass noodles?|roasted|salted peanuts?|whole grain|rye bread|whole olives?|black olives?|green tea|multifrucht|weinsauerkraut|riesenoliven|nuss|mit stein|erbsen|fein|spelt|olives? noires?|olive nere|denocciate|entieres?|carottes?|tomates? cerises?|capres?|brique de chevre|nectarine plate|chair jaune|graines de sesame|fromage|lait|sans sucre|aux herbes)\b/;

const REAL_FOOD_IDENTITY_RE =
  /\b(?:frutas?|fruits?|verduras?|vegetables?|hortalizas?|legumbres?|legumes?|garbanzos?|lentejas?|alubias?|judias?|frejol|cereales?|grains?|avena|oats?|arroz|rice|quinoa|cuscus|couscous|bulgur|pasta|spaghetti|tagliatelle|gnocchi|pan|bread|tostadas?|tortitas? de arroz|patatas?|potatoes?|boniato|sweet potato|leche|milk|yogur|yoghurt|skyr|kefir|quesos?|cheeses?|mozzarella|mascarpone|emmental|gorgonzola|havarti|manchego|pescados?|fish|mariscos?|seafood|atun|bonito|sardina|salmon|bacalao|merluza|sepia|calamar|mejillon|berberecho|carnes?|meats?|pollo|pavo|ternera|cerdo|conejo|huevos?|eggs?|frutos secos|nuts?|almendras?|nueces|anacardos?|pistachos?|cacahuetes?|semillas?|seeds?|sesamo|chia|aceites?|oils?|aceitunas?|olives?|aguacate|avocado|tofu|tempeh|seitan|hummus|gazpacho|salmorejo|tomate|pepino|pimiento|calabacin|berenjena|espinaca|acelga|lechuga|rucula|alcachofa|esparrago|setas?|mushrooms?|champinon|frambuesa|arandano|fresa|manzana|pera|naranja|mandarina|mango|pina|platano|nectarina|melocoton|coco)\b/;

const FLAVORED_DAIRY_RE =
  /\b(?:yogur|yoghurt|skyr|kefir)\b.*\b(?:fresa|frambuesa|mango|melocoton|vainilla|chocolate|galleta|caramelo|fruta)\b|\b(?:fresa|frambuesa|mango|melocoton|vainilla|chocolate|galleta|caramelo|fruta)\b.*\b(?:yogur|yoghurt|skyr|kefir)\b/;

const CORE_WITH_ADDED_SUGAR_RE =
  /\b(?:yogur|yoghurt|skyr|kefir|leche|bebida vegetal|avena|copos|cereales|muesli|granola|pan|tostadas|tortillas? de trigo|hummus)\b/;

const ADDED_SUGAR_RE =
  /\b(?:azucar|sugar|sucre|glucosa|glucose|fructosa|fructose|dextrosa|dextrose|maltodextrina|jarabe|syrup)\b/;

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return String(value)
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstFinite(values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function selectRetailer(product) {
  const haystack = normalize(
    [
      ...asArray(product.stores_tags),
      ...asArray(product.stores),
      product.brands,
      product.brands_tags,
    ].join(" "),
  );
  for (const [retailer, patterns] of Object.entries(RETAILERS)) {
    if (patterns.some((pattern) => pattern.test(haystack))) return retailer;
  }
  return null;
}

function hasSpainEvidence(product) {
  const tags = asArray(product.countries_tags).map(normalize);
  if (tags.some((tag) => tag === "en spain" || tag === "es espana" || tag.endsWith(" spain"))) {
    return true;
  }
  const text = normalize(
    [
      product.countries,
      product.purchase_places,
      product.manufacturing_places,
    ].join(" "),
  );
  return /\b(spain|espana)\b/.test(text);
}

function selectSpanishName(product) {
  const explicit =
    String(product.product_name_es || "").trim() ||
    String(product.generic_name_es || "").trim();
  if (explicit) return { name: explicit, basis: "localized_es" };

  const locale = normalize(product.lc || product.lang);
  const productName = String(product.product_name || "").trim();
  if ((locale === "es" || locale.startsWith("es ")) && productName) {
    return { name: productName, basis: "primary_language_es" };
  }
  return null;
}

function spanishLabelDecision(spanishName) {
  if (FOREIGN_LABEL_RE.test(normalize(spanishName))) {
    return { eligible: false, reason: "foreign_label_in_spanish_field" };
  }
  return { eligible: true };
}

function readMacros(product) {
  const nutriments = product.nutriments || {};
  const calories = firstFinite([
    nutriments["energy-kcal_100g"],
    nutriments.energy_kcal_100g,
  ]);
  const protein = firstFinite([
    nutriments.proteins_100g,
    nutriments.protein_100g,
  ]);
  const carbs = firstFinite([
    nutriments.carbohydrates_100g,
    nutriments.carbs_100g,
  ]);
  const fat = firstFinite([nutriments.fat_100g]);

  if ([calories, protein, carbs, fat].some((value) => value == null)) return null;
  if (calories <= 0 || calories > 1000) return null;
  if ([protein, carbs, fat].some((value) => value < 0 || value > 100)) return null;
  return { calories, protein, carbs, fat };
}

function qualityDecision(product) {
  const errors = [
    ...asArray(product.data_quality_errors_tags),
    ...asArray(product.data_quality_bugs_tags),
  ];
  if (errors.length > 0) {
    return { eligible: false, reason: "off_quality_error", errors };
  }

  const warnings = asArray(product.data_quality_warnings_tags);
  const criticalWarnings = warnings.filter((warning) =>
    CRITICAL_WARNING_RE.test(normalize(warning).replace(/\s+/g, "-")),
  );
  if (criticalWarnings.length > 0) {
    return {
      eligible: false,
      reason: "off_critical_nutrition_warning",
      warnings: criticalWarnings,
    };
  }

  const completeness = Number(product.completeness);
  if (Number.isFinite(completeness) && completeness < 0.5) {
    return { eligible: false, reason: "off_low_completeness", completeness };
  }
  return {
    eligible: true,
    completeness: Number.isFinite(completeness) ? completeness : null,
    warnings,
  };
}

function novaGroup(product) {
  const direct = firstFinite([product.nova_group, product.nova_groups]);
  if (direct != null) return direct;
  const tagText = normalize(asArray(product.nova_groups_tags).join(" "));
  const match = tagText.match(/\b([1-4])\b/);
  return match ? Number(match[1]) : null;
}

function processingDecision(product, spanishName) {
  const nova = novaGroup(product);
  const additives = asArray(product.additives_tags).map(normalize);
  const analysisTags = asArray(product.ingredients_analysis_tags).map(normalize);
  const ingredientsText = normalize(
    product.ingredients_text_es ||
    product.ingredients_text ||
    product.ingredients_text_en ||
    "",
  );
  const productText = normalize([
    spanishName,
    product.generic_name_es,
    product.categories,
    ...asArray(product.categories_tags),
  ].join(" "));
  const containsSweeteners =
    analysisTags.some((tag) => /\bcontains sweeteners\b/.test(tag)) ||
    additives.some((tag) => SWEETENER_ADDITIVE_RE.test(tag)) ||
    /\b(?:aspartamo|acesulfamo|sucralosa|sacarina|ciclamato|estevia|stevia|eritritol|xilitol|maltitol|sorbitol)\b/.test(ingredientsText);

  if (nova === 4) {
    return { eligible: false, reason: "off_nova_group_4", nova_group: nova };
  }
  if (containsSweeteners) {
    return { eligible: false, reason: "off_contains_sweeteners", nova_group: nova };
  }
  if (INDUSTRIAL_PRODUCT_RE.test(productText)) {
    return {
      eligible: false,
      reason: "industrial_product_out_of_scope",
      nova_group: nova,
    };
  }
  if (FLAVORED_DAIRY_RE.test(productText)) {
    return {
      eligible: false,
      reason: "flavored_dairy_out_of_scope",
      nova_group: nova,
    };
  }
  if (ADDED_SUGAR_RE.test(ingredientsText)) {
    return {
      eligible: false,
      reason: CORE_WITH_ADDED_SUGAR_RE.test(productText)
        ? "added_sugar_in_core_food"
        : "added_sugar_out_of_scope",
      nova_group: nova,
    };
  }
  if (!REAL_FOOD_IDENTITY_RE.test(productText)) {
    return {
      eligible: false,
      reason: "food_identity_out_of_scope",
      nova_group: nova,
    };
  }

  return {
    eligible: true,
    nova_group: nova,
    contains_sweeteners: false,
    ingredients_available: Boolean(ingredientsText),
    evidence_status: nova != null || ingredientsText
      ? "processing_evidence_available"
      : "manual_processing_review_required",
  };
}

function curateProduct(product, options = {}) {
  const retailer = selectRetailer(product);
  if (!retailer && !options.includeSpainGeneral) {
    return { eligible: false, reason: "retailer_out_of_scope" };
  }
  if (!hasSpainEvidence(product)) {
    return { eligible: false, reason: "no_spain_market_evidence" };
  }

  const spanishName = selectSpanishName(product);
  if (!spanishName) {
    return { eligible: false, reason: "no_spanish_name" };
  }
  const labelDecision = spanishLabelDecision(spanishName.name);
  if (!labelDecision.eligible) return labelDecision;

  const macros = readMacros(product);
  if (!macros) {
    return { eligible: false, reason: "incomplete_or_invalid_macros" };
  }

  const quality = qualityDecision(product);
  if (!quality.eligible) return quality;

  const processing = processingDecision(product, spanishName.name);
  if (!processing.eligible) return processing;

  const code = String(product.code || "").trim();
  if (!/^\d{8,14}$/.test(code)) {
    return { eligible: false, reason: "invalid_barcode" };
  }

  return {
    eligible: true,
    record: {
      code,
      name: spanishName.name,
      brand: String(product.brands || "").trim() || null,
      retailer: retailer || "spain_general",
      macros,
      processing: {
        nova_group: processing.nova_group,
        contains_sweeteners: processing.contains_sweeteners,
        ingredients_available: processing.ingredients_available,
        evidence_status: processing.evidence_status,
      },
      recommended_scope:
        processing.evidence_status === "manual_processing_review_required"
          ? "manual_review"
          : "scope_policy_review",
      provenance: {
        source: "OpenFoodFacts",
        market: "ES",
        market_basis: "countries_or_purchase_place",
        countries_tags: asArray(product.countries_tags),
        stores_tags: asArray(product.stores_tags),
        language: product.lc || product.lang || null,
        spanish_name_basis: spanishName.basis,
        completeness: quality.completeness,
        quality_errors: [],
        critical_quality_warnings: [],
        extracted_at: new Date().toISOString(),
      },
    },
  };
}

function parseArgs(argv) {
  const options = {
    input: path.join(__dirname, "..", "..", "openfoodfacts-products.jsonl.gz"),
    output: null,
    maxLines: Infinity,
    maxProducts: Infinity,
    includeSpainGeneral: false,
    statsOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") options.input = path.resolve(argv[++index]);
    else if (arg === "--output") options.output = path.resolve(argv[++index]);
    else if (arg === "--max-lines") options.maxLines = Number(argv[++index]);
    else if (arg === "--max-products") options.maxProducts = Number(argv[++index]);
    else if (arg === "--include-spain-general") options.includeSpainGeneral = true;
    else if (arg === "--stats-only") options.statsOnly = true;
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  return options;
}

async function run(options) {
  if (!fs.existsSync(options.input)) {
    throw new Error(`No existe el fichero OFF: ${options.input}`);
  }
  if (!options.statsOnly && !options.output) {
    throw new Error("Indica --output o usa --stats-only");
  }

  const stats = {
    input: options.input,
    lines: 0,
    parsed: 0,
    eligible: 0,
    rejected: {},
    retailers: {},
  };
  const input = fs.createReadStream(options.input).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const output =
    !options.statsOnly && options.output
      ? fs.createWriteStream(options.output, { encoding: "utf8" })
      : null;

  for await (const line of lines) {
    stats.lines += 1;
    if (stats.lines > options.maxLines || stats.eligible >= options.maxProducts) {
      lines.close();
      input.destroy();
      break;
    }

    // Cheap prefilter before JSON.parse. It only removes records that cannot
    // possibly satisfy the default market/store contract.
    if (
      !options.includeSpainGeneral &&
      !/\b(mercadona|carrefour|lidl|aldi|hacendado|bosque verde|deliplus)\b/i.test(line)
    ) {
      stats.rejected.retailer_prefilter =
        (stats.rejected.retailer_prefilter || 0) + 1;
      continue;
    }

    let product;
    try {
      product = JSON.parse(line);
      stats.parsed += 1;
    } catch {
      stats.rejected.invalid_json = (stats.rejected.invalid_json || 0) + 1;
      continue;
    }

    const decision = curateProduct(product, options);
    if (!decision.eligible) {
      stats.rejected[decision.reason] =
        (stats.rejected[decision.reason] || 0) + 1;
      continue;
    }

    stats.eligible += 1;
    const retailer = decision.record.retailer;
    stats.retailers[retailer] = (stats.retailers[retailer] || 0) + 1;
    if (output) {
      if (!output.write(`${JSON.stringify(decision.record)}\n`)) {
        await new Promise((resolve) => output.once("drain", resolve));
      }
    }
  }

  if (output) {
    await new Promise((resolve, reject) => {
      output.end(resolve);
      output.on("error", reject);
    });
  }
  return stats;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  run(options)
    .then((stats) => console.log(JSON.stringify(stats, null, 2)))
    .catch((error) => {
      console.error(error.stack || error);
      process.exitCode = 1;
    });
}

module.exports = {
  RETAILERS,
  normalize,
  selectRetailer,
  hasSpainEvidence,
  selectSpanishName,
  spanishLabelDecision,
  readMacros,
  qualityDecision,
  novaGroup,
  processingDecision,
  curateProduct,
  parseArgs,
  run,
};
