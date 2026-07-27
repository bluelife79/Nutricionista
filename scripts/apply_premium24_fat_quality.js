"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT } = require("./lib/algorithm_harness");

const DB_PATH = path.join(ROOT, "database.json");
const SCOPE_VERSION = "premium-v2.3-scope-1";
const CHOICE_VERSION = "premium-v2.3-choice-1";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function choice(food, level, reasonCode) {
  const copies = {
    preferred: {
      label: "Elección prioritaria",
      summary: "Buena opción para el día a día.",
      detail:
        "Encaja nutricionalmente y, dentro de esta familia, es la opción que prioriza el programa.",
      rank_factor: 1,
    },
    occasional: {
      label: "Uso ocasional",
      summary:
        "Sirve para cubrir la grasa del menú, pero el programa prioriza el aceite de oliva.",
      detail:
        "La cantidad puede cuadrar. La etiqueta expresa la jerarquía del programa, no una prohibición médica.",
      rank_factor: 0.62,
    },
    hidden: {
      label: "No disponible",
      summary: "",
      detail: "",
      rank_factor: 0,
    },
  };
  const copy = copies[level];
  food.choice_guidance = {
    ...(food.choice_guidance || {}),
    version: CHOICE_VERSION,
    level,
    label: copy.label,
    summary: copy.summary,
    detail: copy.detail,
    reason_codes: Array.from(
      new Set([...(food.choice_guidance?.reason_codes || []), reasonCode]),
    ),
    rank_factor: copy.rank_factor,
  };
}

function setScope(food, status, reasonCode) {
  food.exchange_scope = {
    ...(food.exchange_scope || {}),
    version: SCOPE_VERSION,
    status,
    reason_codes: Array.from(
      new Set([...(food.exchange_scope?.reason_codes || []), reasonCode]),
    ),
    context: food.premium_context || food.exchange_scope?.context || null,
  };
}

function classifyFood(food) {
  const name = normalize(food.name);
  const startsAsOil = /^aceite\b/.test(name);
  const isFishPreserve =
    food.category === "protein" &&
    /\b(aceite|vegetal)\b/.test(name) &&
    ["fish_fatty", "fish_white", "seafood"].includes(food.subgroup);

  if (food.id === "bedca_0088") {
    food.fat_quality = "olive";
    food.flags = (food.flags || []).filter((flag) => flag !== "hidden");
    food.culinary_intent = {
      ...(food.culinary_intent || {}),
      validation_status: "release_silent",
    };
    setScope(food, "exchange_core", "premium_2_4_canonical_aove");
    choice(food, "preferred", "premium_2_4_olive_priority");
    return "published_aove";
  }

  if (food.category === "fat" && food.subgroup === "olive_oil") {
    food.fat_quality = "olive";
    if (startsAsOil && food.exchange_scope?.status === "exchange_core") {
      choice(food, "preferred", "premium_2_4_olive_priority");
    }
    return "olive";
  }
  if (food.category === "fat" && food.subgroup === "avocado") {
    food.fat_quality = "avocado";
    return "avocado";
  }
  if (
    food.category === "fat" &&
    (food.premium_context === "olive" || /\baceitun/.test(name))
  ) {
    food.fat_quality = "olive";
    return "olive_whole";
  }
  if (
    food.category === "fat" &&
    food.subgroup === "nuts_seeds" &&
    !startsAsOil
  ) {
    food.fat_quality = "nut_seed_whole";
    return "nut_seed_whole";
  }
  if (food.category === "fat" && /\b(manteca|mantequilla)\b/.test(name)) {
    food.fat_quality = "animal";
    return "animal";
  }

  if (startsAsOil && /\b(palma|algodon|germen de trigo)\b/.test(name)) {
    food.fat_quality = /\bpalma\b/.test(name)
      ? "tropical"
      : "seed_refined";
    setScope(food, "excluded", "premium_2_4_fat_quality_excluded");
    choice(food, "hidden", "premium_2_4_fat_quality_excluded");
    return "excluded_oil";
  }
  if (startsAsOil && /\bpara freir\b/.test(name)) {
    food.fat_quality = "hydrogenated";
    setScope(food, "excluded", "premium_2_4_fat_quality_excluded");
    choice(food, "hidden", "premium_2_4_fat_quality_excluded");
    return "excluded_oil";
  }
  if (startsAsOil && /\bcoco\b/.test(name)) {
    food.fat_quality = "tropical";
    choice(food, "occasional", "premium_2_4_tropical_oil");
    return "occasional_oil";
  }
  if (
    startsAsOil &&
    /\b(soja|girasol|colza|maiz|sesamo|lino|cacahuete|grano de uva|nuez)\b/.test(
      name,
    )
  ) {
    food.fat_quality = "seed_refined";
    choice(food, "occasional", "premium_2_4_seed_refined");
    return "occasional_oil";
  }

  if (isFishPreserve) {
    if (/\b(oliva|aove)\b/.test(name)) {
      food.fat_quality = "olive";
      return "fish_olive";
    }
    if (/\b(girasol|soja|aceite vegetal)\b/.test(name)) {
      food.fat_quality = "seed_refined";
      choice(food, "occasional", "premium_2_4_seed_refined_preserve");
      return "fish_seed";
    }
  }

  return null;
}

function main() {
  const foods = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const counts = {};
  for (const food of foods) {
    const result = classifyFood(food);
    if (result) counts[result] = (counts[result] || 0) + 1;
    if (
      ["excluded", "not_publishable"].includes(food.exchange_scope?.status)
    ) {
      choice(food, "hidden", "catalogue_quality_gate");
    }
  }
  fs.writeFileSync(DB_PATH, `${JSON.stringify(foods, null, 2)}\n`);
  console.log(JSON.stringify({ total: foods.length, counts }, null, 2));
}

main();
