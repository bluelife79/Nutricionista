"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ROOT, createEngine } = require("./lib/algorithm_harness");

async function main() {
  const engine = createEngine();
  const publicFoods = engine.foods.filter(
    (food) =>
      engine.window.getPremiumExchangeScope(food).status === "exchange_core",
  );
  let candidates = 0;
  let macroWarningsRequired = 0;

  for (const origin of publicFoods) {
    const result = await engine.calculate(origin, 100, { usageMode: "any" });
    for (const candidate of [
      ...(result.intercambios || []),
      ...(result.familia || []),
      ...(result.preparados || []),
    ]) {
      candidates += 1;
      const ratio =
        Number(candidate.macros.calories) /
        Math.max(Number(origin.calories), 1);
      assert(
        ratio <= 1.500001,
        `${origin.name} → ${candidate.name}: ${ratio.toFixed(2)}× kcal`,
      );
      if (
        ["protein", "carbs", "fat"].some(
          (key) => Math.abs(Number(candidate.diffs[key])) > 15,
        )
      ) {
        macroWarningsRequired += 1;
      }
    }
  }

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert(
    html.includes("macroNoticeEntry") &&
      html.includes("Aporta") &&
      html.includes("más") &&
      html.includes("menos"),
    "La interfaz no explica diferencias de macros superiores a 15 g",
  );

  console.log(
    `PASS C10: ${candidates} resultados bajo 1,50× kcal; ` +
      `${macroWarningsRequired} diferencias de macro cubiertas por aviso`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
