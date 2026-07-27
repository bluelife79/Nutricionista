"use strict";

const assert = require("assert");
const vm = require("vm");
const { createEngine } = require("./lib/algorithm_harness");

const CASES = [
  ["leche", "bedca_0447"],
  ["yogur", "bedca_0037"],
  ["queso fresco", "bedca_0064"],
  ["pan", "bedca_0068"],
  ["pechuga de pollo", "bedca_0258"],
  ["pimiento", "bedca_0002"],
  ["conejo", "bedca_0926"],
  ["gambas", "bedca_0770"],
  ["solomillo de ternera", "bedca_0698"],
  ["aceite de oliva", "bedca_0081"],
  ["aove", "bedca_0088"],
  ["patatas cocidas", "bedca_0222"],
];

function main() {
  const engine = createEngine();
  const search = vm.runInContext("getLocalSearchResults", engine.context);
  const cookingState = vm.runInContext("getCookingState", engine.context);

  for (const [query, expectedId] of CASES) {
    const results = search(query);
    assert(results.length > 0, `${query}: búsqueda vacía`);
    assert.strictEqual(
      String(results[0].id),
      expectedId,
      `${query}: seleccionó ${results[0].name} en vez de la referencia canónica`,
    );
  }

  for (const query of [
    "pechuga de pollo",
    "pimiento",
    "conejo",
    "gambas",
    "solomillo de ternera",
  ]) {
    assert.strictEqual(
      cookingState(search(query)[0].name),
      "raw",
      `${query}: no abre con el alimento pesado en crudo`,
    );
  }
  assert.strictEqual(
    cookingState(search("patatas cocidas")[0].name),
    "cooked",
    "Una consulta que pide explícitamente cocido no respeta ese estado",
  );

  console.log(
    `PASS C3-search: ${CASES.length} consultas canónicas y prioridad crudo/cocinado`,
  );
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
