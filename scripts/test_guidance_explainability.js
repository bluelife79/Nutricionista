"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ROOT, createEngine } = require("./lib/algorithm_harness");

function main() {
  const engine = createEngine();
  const publicFoods = engine.foods.filter((food) =>
    ["exchange_core", "reference_only"].includes(
      engine.window.getPremiumExchangeScope(food).status,
    ),
  );
  const levels = {};
  for (const food of publicFoods) {
    const guidance = engine.window.getPremiumChoiceGuidance(food);
    levels[guidance.level] = (levels[guidance.level] || 0) + 1;
    assert(
      ["preferred", "compatible", "unverified", "occasional"].includes(
        guidance.level,
      ),
      `${food.name}: nivel editorial desconocido ${guidance.level}`,
    );
    assert(guidance.label, `${food.name}: falta etiqueta editorial`);
    assert(guidance.summary, `${food.name}: falta resumen editorial`);
    assert(guidance.detail, `${food.name}: falta explicación editorial`);
    assert(
      !(
        guidance.level === "preferred" &&
        (guidance.reason_codes || []).includes(
          "packaged_label_not_verified",
        )
      ),
      `${food.name}: un producto sin etiqueta verificada figura como prioritario`,
    );
  }

  for (const id of [
    "off_1dd22a7565",
    "off_e1cab09f44",
    "off_41ea3cd98f",
  ]) {
    const food = engine.foods.find((candidate) => candidate.id === id);
    assert(food, `${id}: falta producto envasado de control`);
    const guidance = engine.window.getPremiumChoiceGuidance(food);
    assert.strictEqual(
      guidance.level,
      "unverified",
      `${food.name}: no informa de que falta verificar la etiqueta`,
    );
    assert(
      (guidance.reason_codes || []).includes(
        "packaged_label_not_verified",
      ),
      `${food.name}: falta la razón de etiqueta no verificada`,
    );
  }

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert(
    html.includes('["compatible", "unverified", "occasional"].includes'),
    "La interfaz no limita los avisos a los casos que de verdad tienen un matiz",
  );
  assert(
    html.includes('<summary>Lo que conviene saber</summary>'),
    "La explicación progresiva no está disponible en las tarjetas",
  );
  assert.doesNotMatch(
    html,
    /Encaja nutricionalmente y no presenta señales/,
    "La interfaz conserva el texto robótico retirado",
  );

  console.log(
    `PASS C12: ${publicFoods.length} alimentos explicables; ` +
      `${levels.preferred || 0} prioritarios, ` +
      `${levels.unverified || 0} con etiqueta pendiente de verificar`,
  );
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
