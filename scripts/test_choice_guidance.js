"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ROOT, createEngine } = require("./lib/algorithm_harness");

async function main() {
  const engine = createEngine();
  const byId = (id) => {
    const food = engine.foods.find((item) => item.id === id);
    assert(food, `Falta alimento de prueba ${id}`);
    return food;
  };

  const preferred = byId("bedca_0037");
  assert.strictEqual(
    engine.window.getPremiumChoiceGuidance(preferred).level,
    "preferred",
  );

  for (const id of [
    "off_81042c6194",
    "off_a624b1851c",
    "off_f38f0e96a1",
    100077,
    100089,
    100092,
  ]) {
    const food = byId(id);
    const scope = engine.window.getPremiumExchangeScope(food);
    const guidance = engine.window.getPremiumChoiceGuidance(food);
    assert.strictEqual(scope.status, "exchange_core", `${food.name}: oculto`);
    assert.strictEqual(
      guidance.level,
      "compatible",
      `${food.name}: sin aviso amarillo`,
    );
    assert(
      (guidance.reason_codes || []).includes("contains_sweeteners"),
      `${food.name}: no explica los edulcorantes`,
    );
    assert.strictEqual(
      guidance.no_added_sugar.status,
      "not_detected",
      `${food.name}: no verificó la ausencia de azúcar añadido`,
    );
  }

  for (const id of [100077, 100089, 100092]) {
    const food = byId(id);
    assert.strictEqual(
      food.processing_evidence?.source,
      "Open Food Facts API v2",
      `${food.name}: falta la procedencia exacta de los ingredientes`,
    );
    assert.strictEqual(
      Number(food.processing_evidence?.nutrients_100g?.added_sugars),
      0,
      `${food.name}: no conserva la declaración de azúcares añadidos`,
    );
    assert(
      /edulcorante/i.test(food.processing_evidence?.ingredients_text_es || ""),
      `${food.name}: el aviso no está respaldado por ingredientes`,
    );
  }

  const withAddedFructose = byId("off_e0b00773aa");
  assert.strictEqual(
    engine.window.getPremiumAddedSugarAssessment(withAddedFructose).status,
    "detected",
  );
  assert.strictEqual(
    engine.window.getPremiumExchangeScope(withAddedFructose).status,
    "excluded",
    "Un yogur con fructosa añadida entró como compatible",
  );

  const uncertainFlavoured = byId("off_baa36240dc");
  assert.strictEqual(
    engine.window.getPremiumExchangeScope(uncertainFlavoured).status,
    "excluded",
    "Un yogur saborizado sin ingredientes verificables entró al catálogo",
  );

  const nova4Natural = byId("off_00932d34bc");
  assert.strictEqual(
    engine.window.getPremiumExchangeScope(nova4Natural).status,
    "exchange_core",
    "NOVA 4 sigue actuando como exclusión automática",
  );
  assert.strictEqual(
    engine.window.getPremiumChoiceGuidance(nova4Natural).level,
    "compatible",
  );

  for (const id of [
    "off_d344c623aa",
    "off_f36156f54b",
    "off_64b8ea3507",
  ]) {
    assert.strictEqual(
      engine.window.getPremiumExchangeScope(byId(id)).status,
      "excluded",
      `${id}: un producto claramente fuera de alcance volvió a entrar`,
    );
  }

  const flavoredOrigin = byId("off_f38f0e96a1");
  const alternatives = await engine.calculate(flavoredOrigin, 125);
  const all = [
    ...alternatives.intercambios,
    ...alternatives.familia,
    ...alternatives.preparados,
  ];
  assert(all.length > 0, "El yogur saborizado compatible quedó sin alternativas");
  assert(
    all.every((food) =>
      ["preferred", "compatible", "unverified"].includes(
        engine.window.getPremiumChoiceGuidance(food).level,
      ),
    ),
    "El yogur compatible recibió una alternativa sin criterio editorial",
  );
  assert(
    all.some(
      (food) =>
        engine.window.getPremiumChoiceGuidance(food).level === "preferred",
    ),
    "El yogur compatible no ofrece ninguna opción prioritaria",
  );

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const scopeSource = fs.readFileSync(
    path.join(ROOT, "js", "exchange_scope.js"),
    "utf8",
  );
  for (const text of [
    "Elección prioritaria",
    "Alternativa compatible",
    "Uso ocasional",
  ]) {
    assert(scopeSource.includes(text), `La política no contiene: ${text}`);
  }
  for (const text of [
    "¿Por qué?",
    "choice-guidance-details",
    "origin-guidance",
    "Opción compatible",
  ]) {
    assert(html.includes(text), `La interfaz no contiene: ${text}`);
  }
  assert(
    !html.includes("ALIMENTO REAL") && !html.includes("Alimento real"),
    "La interfaz usa una etiqueta peyorativa o absoluta",
  );

  console.log(
    "PASS choice guidance: prioridad, compatibilidad, uso ocasional y detalle progresivo",
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
