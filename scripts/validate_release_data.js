"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ROOT } = require("./lib/algorithm_harness");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

const dbPath = path.join(ROOT, "database.json");
const metaPath = path.join(ROOT, "assets", "embeddings_meta.json");
const binPath = path.join(ROOT, "assets", "embeddings.bin");
const dbBytes = fs.readFileSync(dbPath);
const foods = JSON.parse(dbBytes);
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
let quarantinedCount = 0;

if (!Array.isArray(foods)) {
  fail("database.json no es un array plano");
} else {
  const ids = foods.map((food) => String(food.id));
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    fail(`hay ${ids.length - uniqueIds.size} IDs duplicados`);
  }
  const required = ["id", "name", "category", "calories", "protein", "carbs", "fat"];
  const incomplete = foods.filter((food) =>
    required.some((field) => food[field] === undefined || food[field] === null),
  );
  if (incomplete.length > 0) {
    fail(`${incomplete.length} alimentos carecen de campos obligatorios`);
  }
  const quarantined = foods.filter((food) =>
    food.quality_status === "quarantine" ||
    food.subgroup === undefined ||
    food.subgroup === null ||
    food.subgroup === "" ||
    food.subgroup === "?",
  );
  quarantinedCount = quarantined.length;

  const embeddingIds = new Set(Object.keys(meta.index || {}).map(String));
  const missing = ids.filter((id) => !embeddingIds.has(id));
  const stale = [...embeddingIds].filter((id) => !uniqueIds.has(id));
  if (meta.n !== foods.length || missing.length > 0 || stale.length > 0) {
    fail(
      `embeddings desincronizados: DB=${foods.length}, meta=${meta.n}, ` +
        `faltan=${missing.join(",") || "0"}, sobran=${stale.join(",") || "0"}`,
    );
  }
  const binBytes = fs.statSync(binPath).size;
  if (binBytes !== meta.n * meta.dim) {
    fail(`embeddings.bin mide ${binBytes}; esperado ${meta.n * meta.dim}`);
  }
  const hash = crypto.createHash("sha256").update(dbBytes).digest("hex");
  if (meta.db_hash !== hash) {
    fail(`hash de embeddings no coincide con database.json`);
  }

  const visibleDeprecated = foods.filter((food) =>
    /\bdescatalogad[oa]\b/i.test(food.name || "") &&
    !(food.flags || []).includes("hidden"),
  );
  if (visibleDeprecated.length > 0) {
    fail(
      `hay productos descatalogados visibles: ` +
        visibleDeprecated.map((food) => food.id).join(","),
    );
  }

  const visibleRomanianMilk = foods.filter((food) =>
    food.category === "dairy" &&
    /\blapte\b|\bgr[aă]sime\b/i.test(food.name || "") &&
    !(food.flags || []).includes("hidden"),
  );
  if (visibleRomanianMilk.length > 0) {
    fail(
      `hay etiquetas de leche no localizadas visibles: ` +
        visibleRomanianMilk.map((food) => food.id).join(","),
    );
  }

  const pear = foods.find((food) => String(food.id) === "bedca_0404");
  if (!pear || pear.category !== "fruits" || pear.subgroup !== "fruit") {
    fail("Pera BEDCA debe estar clasificada como fruits/fruit");
  }

  const firmTofu = foods.find((food) => String(food.id) === "off_873b01b809");
  if (!firmTofu || firmTofu.dairy_subfamily != null) {
    fail("Tofu firme no debe tener una subfamilia láctea");
  }
}

if (!process.exitCode) {
  console.log(
      `PASS: ${foods.length} alimentos, IDs únicos, schema mínimo y embeddings sincronizados ` +
      `(${quarantinedCount} registros incompletos aislados por cuarentena runtime)`,
  );
}
