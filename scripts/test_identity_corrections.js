#!/usr/bin/env node

"use strict";

const assert = require("assert");
const { createEngine } = require("./lib/algorithm_harness");

const engine = createEngine();

for (const id of [
  "off_a813abc838",
  "off_8699ed70d9",
  "off_2281c80cb0",
  "off_e8c7fba86b",
]) {
  const food = engine.foods.find((item) => item.id === id);
  assert(food, `${id}: falta el atún corregido`);
  assert.match(food.name, /^Atún claro/);
  assert.strictEqual(food.category, "protein");
  assert.strictEqual(food.subgroup, "fish_fatty");
  assert.strictEqual(
    engine.window.inferPremiumContext(food),
    "canned_fish",
  );
  assert.strictEqual(food.weight_basis, "drained");
}

const bifidus = engine.foods.filter(
  (food) => /\bbifidus\b/i.test(String(food.name || "")),
);
assert(bifidus.length >= 30, "La familia bífidus quedó sin cobertura");
for (const food of bifidus) {
  assert.strictEqual(food.category, "dairy", food.name);
  assert.strictEqual(
    engine.window.inferPremiumContext(food),
    "fermented_dairy",
    food.name,
  );
  assert.strictEqual(food.culinary_intent?.family, "fermented_dairy");
}

console.log(
  `PASS C11-identidad: 4 atunes y ${bifidus.length} lácteos bífidus corregidos`,
);
