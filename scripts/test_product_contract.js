"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { runProductBaseline } = require("./audit_product_baseline");
const { runProductIntentAudit } = require("./audit_product_intents");
const { ROOT, createProductHarness } = require("./lib/product_harness");

async function main() {
  const gates = JSON.parse(
    fs.readFileSync(path.join(ROOT, "config", "release_gates.json"), "utf8"),
  );
  const indexSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(indexSource, /src="js\/runtime_config\.js"/);
  assert.match(indexSource, /src="js\/presentation_policy\.js"/);
  assert.doesNotMatch(
    indexSource,
    /window\.SEMANTIC_EMBEDDINGS_ENABLED\s*=/,
    "La UI no puede redefinir flags fuera de runtime_config.js",
  );
  assert.doesNotMatch(
    indexSource,
    /_TOKEN_FAMILY_FIRST|_ROLE_FAMILY_FIRST|_SUBGRP_FAMILY_FIRST/,
    "La UI no puede copiar la política de presentación",
  );

  const harness = createProductHarness();
  for (const [key, expected] of Object.entries(gates.runtime)) {
    assert.strictEqual(
      harness.provenance.runtime[key],
      expected,
      `Flag de navegador/arnés divergente: ${key}`,
    );
  }
  assert.strictEqual(
    harness.provenance.release.catalog_records,
    harness.foods.length,
    "El manifiesto no describe el catálogo realmente ejecutado",
  );
  assert.strictEqual(
    harness.provenance.release.release,
    harness.provenance.runtime.release,
    "El manifiesto y el motor no declaran la misma release",
  );

  const baseline = await runProductBaseline();
  assert.deepStrictEqual(
    baseline.totals,
    gates.candidateExpected,
    "La candidata no coincide con su contrato medido",
  );
  for (const key of [
    "familyFirst",
    "tierInversion",
    "unexplainedWeightBasis",
    "largePortionUnnoticed",
    "seedOilPreferred",
    "foreign",
    "uglyName",
    "calorieCeilingViolation",
  ]) {
    assert.strictEqual(
      baseline.totals[key],
      0,
      `El contrato conserva un defecto crítico: ${key}`,
    );
  }

  const intents = await runProductIntentAudit();
  for (const [key, expected] of Object.entries(gates.intents)) {
    assert.strictEqual(
      intents.totals[key],
      expected,
      `Recorrido culinario incompleto: ${key}`,
    );
  }
  assert.strictEqual(
    Object.values(intents.byPrompt).reduce(
      (total, prompt) => total + prompt.scenarios,
      0,
    ),
    gates.intents.optionScenarios,
    "No se ejecutaron todas las respuestas culinarias publicadas",
  );

  console.log(
    `PASS C13: ${baseline.totals.queries} búsquedas, ` +
      `${baseline.totals.scenarios} escenarios base y ` +
      `${intents.totals.optionScenarios} respuestas culinarias reales`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
