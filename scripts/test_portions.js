"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ROOT, createEngine } = require("./lib/algorithm_harness");

async function main() {
  const engine = createEngine();
  const publicFoods = engine.foods.filter((food) =>
    ["exchange_core", "reference_only"].includes(
      engine.window.getPremiumExchangeScope(food).status,
    ),
  );
  let largeVisible = 0;

  for (const food of publicFoods) {
    const name = String(food.name || "").toLowerCase();
    if (
      /\b(con hueso|c\/h)\b/.test(name) &&
      !/\bsin hueso\b/.test(name)
    ) {
      assert(
        Number(food.edible_fraction) > 0 &&
          Number(food.edible_fraction) < 1,
        `${food.name}: falta fracción comestible`,
      );
    }
    if (
      engine.window.inferPremiumContext(food) === "canned_fish" &&
      /\b(conserva|enlatad|lata|al natural|escabeche|en aceite)\b/.test(name)
    ) {
      assert(
        Number(food.typical_pack_g) > 0,
        `${food.name}: falta tamaño doméstico de conserva`,
      );
    }

    const result = await engine.calculate(food, 100, { usageMode: "any" });
    for (const candidate of (result.intercambios || []).slice(0, 5)) {
      if (Number(candidate.equivalentAmount) >= 350) {
        largeVisible += 1;
        assert.strictEqual(
          candidate.premiumPortionStatus,
          "review",
          `${food.name} → ${candidate.name}: ≥350 g sin aviso`,
        );
      }
      if (
        engine.window.inferPremiumContext(food) === "plant_savory_spread"
      ) {
        assert.notStrictEqual(
          engine.window.inferPremiumContext(candidate),
          "condiment",
          `${food.name} devuelve un condimento como untable`,
        );
      }
    }
  }

  const servingPolicy = JSON.parse(
    fs.readFileSync(path.join(ROOT, "config", "serving_policy.json"), "utf8"),
  );
  assert.strictEqual(servingPolicy.contexts.leafy_vegetable.review_max_g, 250);
  assert.strictEqual(servingPolicy.contexts.leafy_vegetable.hard_max_g, 350);

  const spinach = engine.foods.find((food) => food.name === "Espinaca, hervida");
  const cucumber = engine.foods.find((food) => food.id === "bedca_0080");
  assert(spinach && cucumber, "Faltan verduras canónicas para el control de volumen");
  assert.strictEqual(
    engine.window.getPremiumPortionDecision(
      spinach,
      cucumber,
      200,
      371,
    ).status,
    "reject",
    "Una verdura de casi el doble de volumen no debe mostrarse por exactitud matemática",
  );

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const marker of [
    "edible_fraction",
    "typical_pack_g",
    "hydration_factor",
    "envases escurridos",
    "una vez hidratado",
  ]) {
    assert(html.includes(marker), `La UI no consume ${marker}`);
  }

  console.log(
    `PASS C9: ${largeVisible} raciones ≥350 g con aviso y metadatos domésticos verificados`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
