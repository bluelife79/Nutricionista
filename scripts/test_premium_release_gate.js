"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ROOT, createEngine } = require("./lib/algorithm_harness");
const matrix = require("./premium_matrix.json");
const servingPolicy = require("../config/serving_policy.json");
const reviewDecisions = require("../config/portion_review_decisions.json");
const { runAudit } = require("./audit_premium_matrix");
const { runCatalogAudit } = require("./audit_premium_catalog");

function visible(food) {
  return Boolean(
    food &&
      food.quality_status !== "quarantine" &&
      !(food.flags || []).includes("hidden") &&
      food.subgroup &&
      food.subgroup !== "?",
  );
}

function verifyServingPolicyMirror(engine) {
  const runtime = engine.window.PREMIUM_PORTION_POLICIES;
  const configKeys = Object.keys(servingPolicy.contexts).sort();
  const runtimeKeys = Object.keys(runtime).sort();
  assert.deepStrictEqual(
    runtimeKeys,
    configKeys,
    "La política de raciones del navegador no coincide con la configuración",
  );
  for (const context of configKeys) {
    assert.strictEqual(
      runtime[context].review,
      servingPolicy.contexts[context].review_max_g,
      `${context}: review_max_g desincronizado`,
    );
    assert.strictEqual(
      runtime[context].hard,
      servingPolicy.contexts[context].hard_max_g,
      `${context}: hard_max_g desincronizado`,
    );
  }
}

function verifySourceHierarchy(engine) {
  const context = engine.context;
  const scores = vm.runInContext(
    `({
      bedca: sourceBoost({source: "BEDCA"}),
      mercadona: sourceBoost({source: "Mercadona"}),
      otherSuper: sourceBoost({source: "Eroski"}),
      coreOff: sourceBoost({
        source: "OpenFoodFacts",
        market_provenance: {status: "verified_core_es"}
      }),
      esOff: sourceBoost({
        source: "OpenFoodFacts",
        market_provenance: {status: "verified_spain_other"}
      }),
      unverifiedOff: sourceBoost({source: "OpenFoodFacts"})
    })`,
    context,
  );
  assert(
    scores.bedca > scores.mercadona &&
      scores.mercadona > scores.otherSuper &&
      scores.otherSuper > scores.coreOff &&
      scores.coreOff > scores.esOff &&
      scores.esOff > scores.unverifiedOff,
    `Jerarquía de fuentes incorrecta: ${JSON.stringify(scores)}`,
  );

  const unrelatedOffAffinity = vm.runInContext(
    `sourceAffinityBonus(
      {source: "OpenFoodFacts", brand: "Marca A", market_provenance: {status: "verified_spain_other"}},
      {source: "OpenFoodFacts", brand: "Marca B", market_provenance: {status: "verified_spain_other"}}
    )`,
    context,
  );
  assert(
    unrelatedOffAffinity <= 0.08,
    "Dos productos OFF no pueden recibir afinidad máxima solo por compartir agregador",
  );

  const genericSearchPriority = vm.runInContext(
    `({
      bedca: canonicalSpanishGenericPriority(
        {source: "BEDCA", name: "Queso mozzarella"},
        ["mozzarella"]
      ),
      branded: canonicalSpanishGenericPriority(
        {source: "Dia", name: "Mozzarella"},
        ["mozzarella"]
      )
    })`,
    context,
  );
  assert(
    genericSearchPriority.bedca > genericSearchPriority.branded,
    "Una búsqueda genérica debe abrir con BEDCA cuando existe",
  );
}

async function verifyUnknownContextFailsClosed(engine) {
  const origin = engine.foods.find(
    (food) =>
      visible(food) &&
      engine.window.inferPremiumContext(food) === "unknown",
  );
  assert(origin, "Debe existir un caso no clasificado para probar el cierre seguro");
  const result = await engine.calculate(origin, 100);
  assert.strictEqual(
    result.intercambios.length,
    0,
    `${origin.name}: un contexto desconocido no debe producir intercambio directo`,
  );
}

async function verifyOptionalCulinaryUse(engine) {
  const mozzarella = engine.foods.find(
    (food) => food.id === "bedca_0070",
  );
  assert(mozzarella, "Falta la mozzarella canónica para probar el uso culinario");
  assert.deepStrictEqual(
    Array.from(engine.window.getPremiumUsagePromptOptions(mozzarella)),
    ["cold", "melt", "any"],
    "Mozzarella debe ofrecer la pregunta opcional de uso",
  );
  for (const usageMode of ["cold", "melt"]) {
    const result = await engine.calculate(mozzarella, 60, { usageMode });
    const all = [
      ...result.intercambios,
      ...result.familia,
      ...result.preparados,
    ];
    assert(all.length > 0, `Mozzarella/${usageMode}: no hay opciones`);
    for (const candidate of all) {
      assert(
        engine.window.getPremiumUsageCompatibility(candidate, usageMode)
          .compatible,
        `Mozzarella/${usageMode}: uso incompatible ${candidate.name}`,
      );
    }
  }
}

async function main() {
  assert.strictEqual(
    servingPolicy.status,
    "active_product_safety",
    "La política de raciones debe estar activa antes de publicar",
  );

  const premium = await runAudit();
  const catalog = runCatalogAudit();
  const directCases = matrix.filter((item) => item.mode === "direct").length;

  assert.strictEqual(premium.totals.cases, 100, "La matriz debe tener 100 casos");
  assert.strictEqual(premium.totals.origins_found, 100, "Faltan orígenes");
  assert.strictEqual(
    premium.totals.direct_cases_with_3_or_more,
    directCases,
    "Hay casos directos con menos de tres alternativas",
  );
  assert.strictEqual(premium.coverage_gaps.length, 0, "Hay huecos de cobertura");
  assert.strictEqual(premium.totals.critical_context_mismatches, 0);
  assert.strictEqual(premium.totals.critical_portions, 0);
  assert.strictEqual(premium.totals.metadata_contradictions, 0);
  assert.strictEqual(premium.totals.foreign_labels_in_top5, 0);
  assert.strictEqual(premium.totals.unverified_off_origins, 0);
  assert.strictEqual(premium.totals.unverified_off_in_top5, 0);

  const decisions = new Map(
    reviewDecisions.decisions.map((item) => [
      `${item.case_id}:${item.candidate_id}`,
      item,
    ]),
  );
  for (const finding of premium.portion_findings) {
    if (finding.severity !== "review") continue;
    const decision = decisions.get(
      `${finding.case_id}:${finding.candidate_id}`,
    );
    assert(
      decision,
      `${finding.case_id}/${finding.candidate}: ración grande sin decisión explícita`,
    );
    assert.strictEqual(
      decision.decision,
      "accepted_with_visible_notice",
      `${finding.case_id}/${finding.candidate}: decisión no publicable`,
    );
  }

  assert.strictEqual(catalog.totals.visible_off_outside_market_gate, 0);
  assert.strictEqual(catalog.totals.foreign_visible_names, 0);
  assert.strictEqual(catalog.totals.metadata_contradictions, 0);
  assert.strictEqual(catalog.totals.visible_invalid_core_macros, 0);

  const engine = createEngine();
  verifyServingPolicyMirror(engine);
  verifySourceHierarchy(engine);
  await verifyUnknownContextFailsClosed(engine);
  await verifyOptionalCulinaryUse(engine);

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert(
    html.includes("premiumPortionStatus === \"review\"") &&
      html.includes("portion-review-note"),
    "La interfaz debe mostrar el aviso de ración grande",
  );
  assert(
    html.includes('id="usageContextSection"') &&
      html.includes("usageMode: selectedUsageMode"),
    "La pregunta opcional de uso debe estar conectada al algoritmo",
  );

  console.log(
    `PASS Premium gate: 100/100 casos, ${directCases}/${directCases} con cobertura, ` +
      "0 contextos críticos, 0 raciones críticas, catálogo visible limpio",
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
