"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ROOT, createProductHarness } = require("./lib/product_harness");

const ALLOWED = new Set(["raw", "cooked", "drained", "dry", "as_sold"]);

async function main() {
  const harness = createProductHarness();
  const publicFoods = harness.foods.filter((food) =>
    ["exchange_core", "reference_only"].includes(
      harness.window.getPremiumExchangeScope(food).status,
    ),
  );

  for (const food of publicFoods) {
    assert(
      ALLOWED.has(food.weight_basis),
      `${food.name}: base de peso ausente o inválida`,
    );
    assert.strictEqual(
      food.weight_basis_version,
      harness.window.PREMIUM_WEIGHT_BASIS_VERSION,
      `${food.name}: base de peso sin versión de producto`,
    );
  }

  let visibleCandidates = 0;
  let declaredBridges = 0;
  for (const origin of publicFoods) {
    const result = await harness.calculate(origin, 100, { usageMode: "any" });
    for (const candidate of [
      ...result.intercambios,
      ...result.familia,
      ...result.preparados,
    ]) {
      visibleCandidates += 1;
      const decision =
        harness.window.getPremiumWeightBasisCompatibility(origin, candidate);
      assert(
        decision.compatible,
        `${origin.name} (${origin.weight_basis}) → ${candidate.name} (${candidate.weight_basis})`,
      );
      if (origin.weight_basis !== candidate.weight_basis) {
        assert(
          decision.bridge,
          `${origin.name} → ${candidate.name}: cruce sin puente declarado`,
        );
        declaredBridges += 1;
      }
    }
  }

  for (const [query, expected] of [
    ["pechuga de pollo", "raw"],
    ["pimiento", "raw"],
    ["conejo", "raw"],
    ["gambas", "raw"],
    ["solomillo de ternera", "raw"],
    ["arroz", "dry"],
    ["pasta", "dry"],
    ["patata", "raw"],
    ["patatas cocidas", "cooked"],
    ["tortilla francesa", "cooked"],
  ]) {
    const origin = harness.search(query)[0];
    assert(origin, `${query}: no localizó origen canónico`);
    assert.strictEqual(
      origin.weight_basis,
      expected,
      `${query}: base ${origin.weight_basis}, esperaba ${expected}`,
    );
  }

  for (const query of [
    "pechuga de pollo",
    "merluza",
    "bacalao",
    "pimiento",
    "brócoli",
  ]) {
    const origin = harness.search(query)[0];
    assert(origin, `${query}: falta origen para comprobar la báscula`);
    const result = await harness.calculate(origin, 150, {
      usageMode: "any",
    });
    const visible = [
      ...result.intercambios,
      ...result.familia,
      ...result.preparados,
    ];
    assert(
      visible.every(
        (candidate) =>
          !harness.window.isPremiumStrictRawCookedMismatch(
            origin,
            candidate,
          ),
      ),
      `${query}: todavía publica una mezcla crudo/cocinado`,
    );
  }

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert(
    html.includes("getPremiumWeightBasisLabel") &&
      html.includes("result-weight-basis") &&
      html.includes("premiumWeightBasisBridge"),
    "La interfaz no muestra la base de peso junto a los gramos",
  );

  console.log(
    `PASS C3: ${publicFoods.length} alimentos con base declarada, ` +
      `${visibleCandidates} resultados sin cruces ocultos y ` +
      `${declaredBridges} puentes explicables`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
