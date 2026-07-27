"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT, createEngine } = require("./lib/algorithm_harness");

const DB_PATH = path.join(ROOT, "database.json");
const VERSION = "premium-v2.4-portion-metadata-1";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function main() {
  const engine = createEngine();
  const report = {
    version: VERSION,
    edibleFraction: 0,
    typicalPack: 0,
    hydration: 0,
  };

  for (const food of engine.foods) {
    delete food.edible_fraction;
    delete food.typical_pack_g;
    delete food.hydration_factor;
    delete food.portion_metadata_version;
    const name = normalize(food.name);
    const context = engine.window.inferPremiumContext(food);

    if (!/\b(sin hueso|deshuesad\w*)\b/.test(name)) {
      if (/\b(con hueso|c h)\b/.test(name)) {
        food.edible_fraction = context === "olive" ? 0.8 : 0.75;
      } else if (/\b(con cascara|caparazon)\b/.test(name)) {
        food.edible_fraction = context === "seafood" ? 0.45 : 0.5;
      }
    }

    const cannedLike =
      /\b(conserva|enlatad|lata|al natural|escabeche|en aceite)\b/.test(name);
    if (context === "canned_fish" && cannedLike) {
      food.typical_pack_g = 65;
    } else if (
      cannedLike &&
      context === "seafood"
    ) {
      food.typical_pack_g = 70;
    } else if (
      cannedLike &&
      context === "cooked_legume"
    ) {
      food.typical_pack_g = 240;
    } else if (
      cannedLike &&
      [
        "leafy_vegetable",
        "cruciferous",
        "fruiting_vegetable",
        "root_vegetable",
        "stalk_vegetable",
        "other_vegetable",
      ].includes(context)
    ) {
      food.typical_pack_g = 200;
    } else if (context === "olive") {
      food.typical_pack_g = 120;
    }

    if (
      food.weight_basis === "dry" &&
      (
        context === "plant_protein" ||
        /\b(soja texturizada|legumbre seca)\b/.test(name)
      )
    ) {
      food.hydration_factor = 3;
    }

    if (
      food.edible_fraction ||
      food.typical_pack_g ||
      food.hydration_factor
    ) {
      food.portion_metadata_version = VERSION;
    }
    if (food.edible_fraction) report.edibleFraction += 1;
    if (food.typical_pack_g) report.typicalPack += 1;
    if (food.hydration_factor) report.hydration += 1;
  }

  fs.writeFileSync(DB_PATH, `${JSON.stringify(engine.foods, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main();
