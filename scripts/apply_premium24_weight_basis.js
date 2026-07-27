"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT, createEngine } = require("./lib/algorithm_harness");

const DB_PATH = path.join(ROOT, "database.json");
const VERSION = "premium-v2.4-weight-basis-1";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferWeightBasis(food, context) {
  const name = normalize(food.name);
  const drained =
    /\b(en conserva|enlatad|escurrid|al natural)\b/.test(name) ||
    context === "canned_fish";
  if (drained) return ["drained", "preserved_food_drained_weight"];

  const dry =
    /\b(seco|seca|desecad\w*|deshidratad\w*|liofilizad\w*|en polvo|harina|semola|almidon|fecula|soja texturizada)\b/.test(
      name,
    );
  if (dry) return ["dry", "dry_or_dehydrated_food"];

  const cooked =
    /\b(cocid|hervid|asad|plancha|parrilla|frit|guisad|estofad|hornead|al horno|al vapor|escalfad|saltead|rehogad|tostad)\w*\b/.test(
      name,
    );
  if (cooked) return ["cooked", "explicit_cooked_state"];

  if (
    food.raw_ingredient === true &&
    (
      food.subgroup === "grains" ||
      [
        "breakfast_cereal",
        "dry_grain",
        "cooked_legume",
        "baking_input",
        "plant_protein",
      ].includes(context)
    )
  ) {
    return ["dry", "dry_ingredient_identity"];
  }

  // Arroz, pasta, copos y cereales sin marcador de cocción suelen venir en
  // seco. La densidad energética permite separar de forma conservadora una
  // pasta seca (~330 kcal/100 g) de una bolsa ya cocinada (~130 kcal/100 g)
  // cuando la fuente comercial omitió el estado en el nombre.
  if (
    food.category === "carbs" &&
    food.subgroup === "grains" &&
    Number(food.calories) >= 260
  ) {
    return ["dry", "dense_grain_or_pasta_identity"];
  }

  if (
    context === "cooked_legume" &&
    /\bfresc\w*\b/.test(name)
  ) {
    return ["raw", "fresh_legume_identity"];
  }

  if (
    food.subgroup === "tubers" &&
    /^(batata|boniato|patata|patatas|yuca)(\b|$)/.test(name) &&
    !/\b(pure|conserva|prefrit|frit|cocid|hervid|asad|hornead)\w*\b/.test(name)
  ) {
    return ["raw", "fresh_tuber_identity"];
  }

  const rawContexts = [
    "lean_meat",
    "fatty_meat",
    "minced_meat",
    "white_fish",
    "fatty_fish",
    "seafood",
    "tuber",
    "leafy_vegetable",
    "cruciferous",
    "fruiting_vegetable",
    "root_vegetable",
    "stalk_vegetable",
    "other_vegetable",
    "whole_fruit",
  ];
  const raw =
    /\b(crud|sin cocer)\w*\b/.test(name) ||
    (rawContexts.includes(context) && /\bfresc\w*\b/.test(name));
  if (raw) return ["raw", "explicit_raw_state"];

  if (
    [
      ...rawContexts,
      "egg",
    ].includes(context)
  ) {
    return ["raw", "fresh_food_identity"];
  }

  if (
    ["cooked_grain", "cooked_tuber", "cooked_legume"].includes(context) &&
    food.ready_to_eat === true
  ) {
    return ["cooked", "ready_to_eat_cooked_identity"];
  }

  if (context === "dry_grain") {
    return ["dry", "dry_staple_identity"];
  }
  return ["as_sold", "served_as_sold"];
}

function main() {
  const engine = createEngine();
  const report = { version: VERSION, counts: {}, publicMissing: 0 };
  for (const food of engine.foods) {
    const context = engine.window.inferPremiumContext(food);
    const [basis, reason] = inferWeightBasis(food, context);
    food.weight_basis = basis;
    food.weight_basis_version = VERSION;
    food.weight_basis_reason = reason;
    report.counts[basis] = (report.counts[basis] || 0) + 1;
  }
  report.publicMissing = engine.foods.filter(
    (food) =>
      ["exchange_core", "reference_only"].includes(
        engine.window.getPremiumExchangeScope(food).status,
      ) && !food.weight_basis,
  ).length;
  fs.writeFileSync(DB_PATH, `${JSON.stringify(engine.foods, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main();
