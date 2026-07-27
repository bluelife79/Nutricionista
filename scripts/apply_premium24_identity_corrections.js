#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT } = require("./lib/algorithm_harness");

const DB_PATH = path.join(ROOT, "database.json");
const TUNA_NAMES = {
  off_a813abc838: "Atún claro en aceite de oliva",
  off_8699ed70d9: "Atún claro al natural",
  off_2281c80cb0: "Atún claro en aceite de oliva",
  off_e8c7fba86b: "Atún claro en aceite",
};

function addReason(food, reason) {
  food.quality_reasons = Array.from(
    new Set([...(food.quality_reasons || []), reason]),
  );
}

function main() {
  const foods = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const report = { tuna: 0, bifidus: 0 };

  for (const food of foods) {
    if (TUNA_NAMES[food.id]) {
      if (!food.original_name) food.original_name = food.name;
      food.name = TUNA_NAMES[food.id];
      food.category = "protein";
      food.subgroup = "fish_fatty";
      food.premium_context = "canned_fish";
      food.weight_basis = "drained";
      food.weight_basis_reason = "preserved_food_drained_weight";
      food.clean_protein = true;
      if (food.culinary_intent) {
        food.culinary_intent.family = "fish";
      }
      addReason(food, "premium_2_4_tuna_identity_corrected");
      report.tuna += 1;
    }

    if (
      food.category !== "dairy" &&
      /\bbifidus\b/i.test(String(food.name || ""))
    ) {
      food.category = "dairy";
      food.subgroup =
        Number(food.fat) <= 1.5 ? "low_fat_dairy" : "whole_dairy";
      food.premium_context = "fermented_dairy";
      food.dairy_subfamily = "yogur_kefir";
      delete food.clean_carb;
      food.culinary_intent = {
        ...(food.culinary_intent || {}),
        version: "premium-v2.3-intent-1",
        family: "fermented_dairy",
        uses: ["spoon", "cooking_sauce"],
        primary_uses: ["spoon"],
        prompt_id: "fermented_dairy_use",
        validated_modes: [],
        validation_status: "release_candidate",
      };
      addReason(food, "premium_2_4_bifidus_identity_corrected");
      report.bifidus += 1;
    }
  }

  fs.writeFileSync(DB_PATH, `${JSON.stringify(foods, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main();
