"use strict";

const assert = require("assert");
const {
  formatHouseholdMeasure,
} = require("../js/household_measures");

assert.strictEqual(
  formatHouseholdMeasure(
    {
      name: "Mozzarella con leche pasteurizada de vaca",
      subgroup: "fresh_cheese",
    },
    81,
  ),
  "≈ 3 porciones",
);
assert.strictEqual(
  formatHouseholdMeasure(
    {
      name: "Rulo de cabra elaborado con leche pasteurizada",
      subgroup: "aged_cheese",
    },
    40,
  ),
  null,
);
assert.strictEqual(
  formatHouseholdMeasure(
    {
      name: "Leche semidesnatada",
      subgroup: "whole_dairy",
    },
    200,
  ),
  "≈ 1 vaso",
);

console.log(
  "PASS medidas caseras: queso sin vasos y leche con unidad líquida",
);
