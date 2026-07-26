"use strict";

/**
 * Restores market/language/quality provenance for the legacy OFF rows that
 * already exist in database.json. The raw global dump is scanned once and
 * only barcodes used by the active catalogue are parsed in full.
 *
 * Safe default: read-only report.
 *   node scripts/enrich_active_off_provenance.js --input ../openfoodfacts-products.jsonl.gz
 *
 * Apply provenance fields without hiding/removing any food:
 *   node scripts/enrich_active_off_provenance.js --input ../openfoodfacts-products.jsonl.gz --apply
 *
 * Quarantine is deliberately a separate, later decision. This script only
 * records evidence.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const zlib = require("zlib");
const {
  normalize,
  selectRetailer,
  hasSpainEvidence,
  selectSpanishName,
  readMacros,
  qualityDecision,
} = require("./curate_off_spain");

const ROOT = path.join(__dirname, "..");
const DB_PATH = path.join(ROOT, "database.json");

function parseArgs(argv) {
  const options = {
    input: path.join(ROOT, "..", "openfoodfacts-products.jsonl.gz"),
    apply: false,
    progressEvery: 250000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") options.input = path.resolve(argv[++index]);
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--progress-every") options.progressEvery = Number(argv[++index]);
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  return options;
}

function statusFor(product) {
  const retailer = selectRetailer(product);
  const spain = hasSpainEvidence(product);
  const spanishName = selectSpanishName(product);
  const macros = readMacros(product);
  const quality = qualityDecision(product);

  let status = "needs_review";
  let rejectionReason = null;
  if (!spain) {
    status = "out_of_scope_no_spain_evidence";
    rejectionReason = "no_spain_market_evidence";
  } else if (!spanishName) {
    status = "out_of_scope_no_spanish_name";
    rejectionReason = "no_spanish_name";
  } else if (!macros) {
    status = "invalid_macros";
    rejectionReason = "incomplete_or_invalid_macros";
  } else if (!quality.eligible) {
    status = "off_quality_rejected";
    rejectionReason = quality.reason;
  } else if (retailer) {
    status = "verified_core_es";
  } else {
    status = "verified_spain_other";
  }

  return {
    status,
    market: spain ? "ES" : null,
    retailer,
    spanish_name: spanishName ? spanishName.name : null,
    spanish_name_basis: spanishName ? spanishName.basis : null,
    language: product.lc || product.lang || null,
    countries_tags: Array.isArray(product.countries_tags)
      ? product.countries_tags
      : [],
    stores_tags: Array.isArray(product.stores_tags)
      ? product.stores_tags
      : [],
    completeness: Number.isFinite(Number(product.completeness))
      ? Number(product.completeness)
      : null,
    quality_errors: [
      ...(Array.isArray(product.data_quality_errors_tags)
        ? product.data_quality_errors_tags
        : []),
      ...(Array.isArray(product.data_quality_bugs_tags)
        ? product.data_quality_bugs_tags
        : []),
    ],
    rejection_reason: rejectionReason,
  };
}

async function scan(options) {
  const foods = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const targetsByCode = new Map();

  for (const food of foods) {
    if (normalize(food.source) !== "openfoodfacts") continue;
    const code = String(food.code || "").trim();
    if (!code) continue;
    if (!targetsByCode.has(code)) targetsByCode.set(code, []);
    targetsByCode.get(code).push(food);
  }

  const stats = {
    active_off_rows: foods.filter(
      (food) => normalize(food.source) === "openfoodfacts",
    ).length,
    active_off_with_code: [...targetsByCode.values()].reduce(
      (sum, rows) => sum + rows.length,
      0,
    ),
    unique_target_codes: targetsByCode.size,
    dump_lines: 0,
    raw_matches: 0,
    rows_enriched: 0,
    statuses: {},
    unmatched_codes: 0,
    applied: options.apply,
  };
  const foundCodes = new Set();
  const input = fs.createReadStream(options.input).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    stats.dump_lines += 1;
    const match = line.match(/"code"\s*:\s*"([^"]+)"/);
    if (!match || !targetsByCode.has(match[1]) || foundCodes.has(match[1])) {
      if (
        options.progressEvery > 0 &&
        stats.dump_lines % options.progressEvery === 0
      ) {
        console.error(
          `[off-provenance] lines=${stats.dump_lines} matches=${stats.raw_matches}/${targetsByCode.size}`,
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

    const code = match[1];
    const provenance = {
      source: "OpenFoodFacts",
      ...statusFor(product),
      restored_from_dump: path.basename(options.input),
      restored_at: new Date().toISOString(),
    };
    foundCodes.add(code);
    stats.raw_matches += 1;
    stats.statuses[provenance.status] =
      (stats.statuses[provenance.status] || 0) +
      targetsByCode.get(code).length;

    for (const food of targetsByCode.get(code)) {
      food.market_provenance = provenance;
      stats.rows_enriched += 1;
    }

    if (foundCodes.size === targetsByCode.size) {
      lines.close();
      input.destroy();
      break;
    }
  }

  for (const [code, rows] of targetsByCode.entries()) {
    if (foundCodes.has(code)) continue;
    stats.unmatched_codes += 1;
    stats.statuses.raw_record_not_found =
      (stats.statuses.raw_record_not_found || 0) + rows.length;
    for (const food of rows) {
      food.market_provenance = {
        source: "OpenFoodFacts",
        status: "raw_record_not_found",
        market: null,
        retailer: null,
        rejection_reason: "barcode_not_found_in_dump",
        restored_from_dump: path.basename(options.input),
        restored_at: new Date().toISOString(),
      };
      stats.rows_enriched += 1;
    }
  }

  const withoutCode = foods.filter(
    (food) =>
      normalize(food.source) === "openfoodfacts" &&
      !String(food.code || "").trim(),
  );
  for (const food of withoutCode) {
    food.market_provenance = {
      source: "OpenFoodFacts",
      status: "missing_barcode",
      market: null,
      retailer: null,
      rejection_reason: "active_row_has_no_barcode",
      restored_from_dump: path.basename(options.input),
      restored_at: new Date().toISOString(),
    };
    stats.rows_enriched += 1;
    stats.statuses.missing_barcode =
      (stats.statuses.missing_barcode || 0) + 1;
  }

  if (options.apply) {
    fs.writeFileSync(DB_PATH, `${JSON.stringify(foods, null, 2)}\n`, "utf8");
  }
  return stats;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.input)) {
    console.error(`No existe el fichero OFF: ${options.input}`);
    process.exitCode = 1;
  } else {
    scan(options)
      .then((stats) => console.log(JSON.stringify(stats, null, 2)))
      .catch((error) => {
        console.error(error.stack || error);
        process.exitCode = 1;
      });
  }
}

module.exports = { parseArgs, statusFor, scan };
