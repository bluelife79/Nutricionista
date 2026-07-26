/**
 * Premium v2 context and portion policy.
 *
 * This file contains deterministic, explainable product rules. It does not
 * calculate nutrition and it does not use generated prose as ground truth.
 * The serving thresholds are product-safety and usability signals, not
 * prescriptions. They determine whether a mathematical result is practical
 * enough to show directly, should carry a visible notice, or must be hidden.
 */
(function (global) {
  "use strict";

  var VERSION = "premium-v2-context-1";

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function hasAny(text, patterns) {
    return patterns.some(function (pattern) {
      return pattern.test(text);
    });
  }

  function inferContext(food) {
    if (!food) return "unknown";
    if (food.premium_context) return String(food.premium_context);
    var name = normalize(food.name);
    var subgroup = String(food.subgroup || "").toLowerCase();
    var category = String(food.category || "").toLowerCase();
    var flags = Array.isArray(food.flags) ? food.flags : [];

    if (subgroup === "cold_soup" || food.cold_soup === true) return "cold_soup";
    if (hasAny(name, [/\bchocolate\b/, /\bcacao\b/, /\bxocolata\b/])) return "chocolate";
    if (hasAny(name, [/\bguacamole\b/, /\bhummus\b/])) return "savory_spread";

    if (
      flags.includes("prepared") ||
      hasAny(name, [
        /\bpaella\b/, /\blasan\w*\b/, /\btortilla de patata\b/,
        /\bempanad\w*\b/, /\bpizza\b/, /\bcroqueta\w*\b/,
        /\bensalada\b/, /\brisotto\b/, /\bchili con carne\b/,
        /\bpasta\w* rellena\w*\b/, /\barroz marinera\b/,
      ])
    ) {
      return "prepared_meal";
    }

    if (category === "carbs") {
      if (subgroup === "tubers") {
        return food.raw_ingredient === true ? "tuber" : "cooked_tuber";
      }
      if (subgroup === "legumes") return "cooked_legume";
      if (
        hasAny(name, [
          /\bpan\w*\b/, /\bhogaza\b/, /\bmolde\b/, /\bpita\b/,
          /\bwrap\w*\b/, /\btortilla\w* de (trigo|maiz)\b/,
        ])
      ) {
        return "bread";
      }
      if (
        hasAny(name, [
          /\bavena\b/, /\bcopos\b/, /\bmuesli\b/, /\bgranola\b/,
          /\bporridge\b/, /\bcereal\w* de desayuno\b/,
        ])
      ) {
        return "breakfast_cereal";
      }
      return food.raw_ingredient === true ? "dry_grain" : "cooked_grain";
    }

    if (category === "protein") {
      if (subgroup === "plant_protein") return "plant_protein";
      if (subgroup === "legumes") return "cooked_legume";
      if (subgroup === "processed_meat") return "processed_meat";
      if (subgroup === "eggs") return "egg";
      if (subgroup === "fish_white") {
        return hasAny(name, [/\b(lata|conserva|aceite|natural)\b/])
          ? "canned_fish"
          : "white_fish";
      }
      if (subgroup === "fish_fatty") {
        return hasAny(name, [/\b(lata|conserva|aceite|natural|escabeche)\b/])
          ? "canned_fish"
          : "fatty_fish";
      }
      if (subgroup === "seafood") return "seafood";
      if (hasAny(name, [/\bpicad\w*\b/, /\bhamburgues\w*\b/, /\bminced\b/])) {
        return "minced_meat";
      }
      if (subgroup === "meat_fatty") return "fatty_meat";
      return "lean_meat";
    }

    if (category === "dairy" || category === "postres_proteicos") {
      if (
        hasAny(name, [/\bbebida de (soja|avena|almendra|arroz)\b/])
      ) {
        return "plant_drink";
      }
      if (
        subgroup === "fresh_cheese" ||
        hasAny(name, [
          /\bqueso fresco\b/, /\brequeson\b/, /\bricotta\b/,
          /\bcottage\b/, /\bmato\b/,
        ])
      ) {
        return "fresh_cheese";
      }
      if (subgroup === "aged_cheese") return "aged_cheese";
      if (
        hasAny(name, [/\byogur\w*\b/, /\bkefir\b/, /\bskyr\b/, /\bquark\b/]) ||
        ["whole_dairy", "low_fat_dairy", "high_protein_dairy"].includes(subgroup)
      ) {
        return "fermented_dairy";
      }
      if (hasAny(name, [/\bleche\b/]) && !hasAny(name, [/\bchocolate\b/, /\bcacao\b/])) {
        return "milk";
      }
      return "unknown";
    }

    if (category === "fruits") return "whole_fruit";

    if (category === "vegetables") {
      if (subgroup === "leafy") return "leafy_vegetable";
      if (subgroup === "cruciferous") return "cruciferous";
      if (subgroup === "fruiting_veg") return "fruiting_vegetable";
      if (subgroup === "root_veg") return "root_vegetable";
      if (subgroup === "stalk_veg") return "stalk_vegetable";
      return "other_vegetable";
    }

    if (category === "fat") {
      if (["olive_oil", "other_oils", "butter_margarine"].includes(subgroup)) {
        return "oil";
      }
      if (subgroup === "avocado" || hasAny(name, [/\bguacamole\b/])) return "avocado";
      if (subgroup === "nuts_seeds") return "nuts_seeds";
      if (hasAny(name, [/\baceitun\w*\b/, /\boliva\w*\b/, /\bolives?\b/])) return "olive";
      if (hasAny(name, [/\bcrema\b/, /\bmantequilla de\b/])) return "nut_spread";
    }

    if (hasAny(name, [/\bavocado\b/, /\bavocat\b/])) return "avocado";
    if (hasAny(name, [/\baceitun\w*\b/, /\boliva\w*\b/, /\bolives?\b/])) return "olive";

    return "unknown";
  }

  var COHORT = {
    breakfast_cereal: "carb_breakfast",
    bread: "carb_bread",
    dry_grain: "carb_staple",
    cooked_grain: "carb_staple",
    tuber: "carb_staple",
    cooked_tuber: "carb_staple",
    lean_meat: "protein_meal",
    fatty_meat: "protein_meal",
    minced_meat: "protein_meal",
    egg: "protein_meal",
    white_fish: "protein_meal",
    fatty_fish: "protein_meal",
    canned_fish: "protein_meal",
    seafood: "protein_meal",
    processed_meat: "protein_processed",
    plant_protein: "protein_plant",
    cooked_legume: "protein_plant",
    milk: "milk",
    plant_drink: "plant_drink",
    fermented_dairy: "fermented_dairy",
    fresh_cheese: "fresh_cheese",
    aged_cheese: "aged_cheese",
    whole_fruit: "fruit",
    leafy_vegetable: "vegetable",
    cruciferous: "vegetable",
    fruiting_vegetable: "vegetable",
    root_vegetable: "vegetable",
    stalk_vegetable: "vegetable",
    other_vegetable: "vegetable",
    oil: "fat",
    nuts_seeds: "fat",
    avocado: "fat",
    olive: "fat",
    nut_spread: "fat",
    chocolate: "chocolate",
    cold_soup: "cold_soup",
    savory_spread: "savory_spread",
    prepared_meal: "prepared_meal",
    unknown: "unknown",
  };

  // UI practicality limits, mirrored in config/serving_policy.json. They are
  // not diet prescriptions: they decide whether an exact mathematical result
  // can be shown as a direct, understandable serving.
  var PORTIONS = {
    breakfast_cereal: { review: 120, hard: 250 },
    bread: { review: 180, hard: 300 },
    dry_grain: { review: 150, hard: 250 },
    cooked_grain: { review: 350, hard: 500 },
    tuber: { review: 400, hard: 550 },
    cooked_tuber: { review: 400, hard: 550 },
    lean_meat: { review: 250, hard: 400 },
    fatty_meat: { review: 250, hard: 400 },
    minced_meat: { review: 250, hard: 400 },
    processed_meat: { review: 100, hard: 180 },
    egg: { review: 220, hard: 350 },
    white_fish: { review: 300, hard: 450 },
    fatty_fish: { review: 250, hard: 400 },
    canned_fish: { review: 200, hard: 300 },
    seafood: { review: 300, hard: 450 },
    plant_protein: { review: 300, hard: 450 },
    cooked_legume: { review: 300, hard: 450 },
    milk: { review: 400, hard: 550 },
    plant_drink: { review: 400, hard: 550 },
    fermented_dairy: { review: 300, hard: 450 },
    fresh_cheese: { review: 200, hard: 300 },
    aged_cheese: { review: 100, hard: 160 },
    whole_fruit: { review: 350, hard: 500 },
    leafy_vegetable: { review: 400, hard: 550 },
    cruciferous: { review: 400, hard: 550 },
    fruiting_vegetable: { review: 400, hard: 550 },
    root_vegetable: { review: 400, hard: 550 },
    stalk_vegetable: { review: 400, hard: 550 },
    other_vegetable: { review: 400, hard: 550 },
    oil: { review: 30, hard: 50 },
    nuts_seeds: { review: 60, hard: 100 },
    avocado: { review: 200, hard: 300 },
    olive: { review: 120, hard: 200 },
    nut_spread: { review: 60, hard: 100 },
    chocolate: { review: 60, hard: 100 },
    cold_soup: { review: 450, hard: 600 },
    savory_spread: { review: 120, hard: 200 },
    prepared_meal: { review: 450, hard: 600 },
    unknown: { review: 300, hard: 500 },
  };

  function portionDecision(originFood, candidateFood, originAmount, equivalentAmount) {
    var originContext = inferContext(originFood);
    var candidateContext = inferContext(candidateFood);
    var policy = PORTIONS[candidateContext] || PORTIONS.unknown;
    var amount = Number(equivalentAmount);
    var baseAmount = Number(originAmount);
    var multiplier =
      Number.isFinite(baseAmount) && baseAmount > 0 ? amount / baseAmount : 1;

    if (!Number.isFinite(amount) || amount < 5 || amount > policy.hard) {
      return {
        status: "reject",
        reason: "outside_hard_practical_limit",
        context: candidateContext,
        multiplier: multiplier,
        reviewMax: policy.review,
        hardMax: policy.hard,
      };
    }

    // Very low-calorie vegetables can be mathematically exact at 450–500 g,
    // but that is not a useful direct card for the intended interface.
    if (
      COHORT[candidateContext] === "vegetable" &&
      amount > policy.review
    ) {
      return {
        status: "reject",
        reason: "vegetable_portion_not_practical",
        context: candidateContext,
        multiplier: multiplier,
        reviewMax: policy.review,
        hardMax: policy.hard,
      };
    }

    // Spoonable dairy above the review serving is exactly the failure mode
    // observed in the product audit (125 g yogurt -> 304–350 g alternative).
    if (
      ["fermented_dairy", "fresh_cheese", "aged_cheese"].includes(candidateContext) &&
      amount > policy.review
    ) {
      return {
        status: "reject",
        reason: "dairy_portion_not_practical",
        context: candidateContext,
        multiplier: multiplier,
        reviewMax: policy.review,
        hardMax: policy.hard,
      };
    }

    var originCohort = COHORT[originContext];
    var candidateCohort = COHORT[candidateContext];
    var legitimateDryWetCarb =
      ["carb_breakfast", "carb_bread", "carb_staple"].includes(originCohort) &&
      candidateCohort === "carb_staple" &&
      amount <= policy.review;

    if (
      amount > policy.review ||
      (multiplier > 2.5 && !legitimateDryWetCarb)
    ) {
      return {
        status: "review",
        reason: amount > policy.review
          ? "above_review_serving"
          : "large_quantity_multiplier",
        context: candidateContext,
        multiplier: multiplier,
        reviewMax: policy.review,
        hardMax: policy.hard,
      };
    }

    return {
      status: "direct",
      reason: "practical_exact_serving",
      context: candidateContext,
      multiplier: multiplier,
      reviewMax: policy.review,
      hardMax: policy.hard,
    };
  }

  function compatibility(originFood, candidateFood) {
    var origin = inferContext(originFood);
    var candidate = inferContext(candidateFood);
    var originCohort = COHORT[origin] || "unknown";
    var candidateCohort = COHORT[candidate] || "unknown";

    if (origin === candidate && origin === "unknown") {
      return {
        compatible: false,
        priority: 9,
        origin: origin,
        candidate: candidate,
        reason: "unclassified_context_requires_review",
      };
    }
    if (origin === candidate) {
      return { compatible: true, priority: 0, origin: origin, candidate: candidate, reason: "same_context" };
    }
    if (originCohort !== "unknown" && originCohort === candidateCohort) {
      return { compatible: true, priority: 1, origin: origin, candidate: candidate, reason: "same_cohort" };
    }

    var milkBridge =
      (origin === "milk" && candidate === "plant_drink") ||
      (origin === "plant_drink" && candidate === "milk");
    if (milkBridge) {
      return { compatible: true, priority: 2, origin: origin, candidate: candidate, reason: "milk_family_bridge" };
    }

    var carbBridge =
      ["carb_breakfast", "carb_bread", "carb_staple"].includes(originCohort) &&
      ["carb_breakfast", "carb_bread", "carb_staple"].includes(candidateCohort);
    if (carbBridge) {
      return { compatible: true, priority: 2, origin: origin, candidate: candidate, reason: "carb_secondary_bridge" };
    }

    var guacamoleBridge =
      (origin === "savory_spread" && candidate === "avocado") ||
      (origin === "avocado" && candidate === "savory_spread");
    if (guacamoleBridge) {
      return { compatible: true, priority: 1, origin: origin, candidate: candidate, reason: "avocado_spread_bridge" };
    }

    return { compatible: false, priority: 9, origin: origin, candidate: candidate, reason: "context_mismatch" };
  }

  // Algunas familias comparten macros pero no uso culinario. Solo preguntamos
  // cuando la intención cambia de verdad el resultado; mozzarella es el primer
  // caso explícito (ensalada/frío frente a fundir/gratinar).
  function preparationUses(food) {
    var name = normalize(food && food.name);
    if (hasAny(name, [/\brallad\w*\b/, /\bgratin\w*\b/, /\bfundir\b/, /\bprovolone\b/, /\bfundid\w*\b/])) {
      return ["melt"];
    }
    if (hasAny(name, [/\bmozzarella\b/, /\bmozzarela\b/])) {
      return ["cold", "melt"];
    }
    if (hasAny(name, [
      /\bensalada\b/, /\bburgos\b/, /\brequeson\b/, /\bricotta\b/,
      /\bcottage\b/, /\bfeta\b/, /\bqueso fresco\b/, /\bmato\b/,
    ])) {
      return ["cold"];
    }
    if (inferContext(food) === "fresh_cheese") return ["cold", "melt"];
    return ["any"];
  }

  function usagePromptOptions(food) {
    var name = normalize(food && food.name);
    if (hasAny(name, [/\bmozzarella\b/, /\bmozzarela\b/])) {
      return ["cold", "melt", "any"];
    }
    return [];
  }

  function usageCompatibility(candidateFood, requestedUse) {
    if (!requestedUse || requestedUse === "any") {
      return { compatible: true, requested: "any", candidateUses: preparationUses(candidateFood) };
    }
    var uses = preparationUses(candidateFood);
    return {
      compatible: uses.includes("any") || uses.includes(requestedUse),
      requested: requestedUse,
      candidateUses: uses,
    };
  }

  global.PREMIUM_CONTEXT_VERSION = VERSION;
  global.PREMIUM_CONTEXT_COHORTS = COHORT;
  global.PREMIUM_PORTION_POLICIES = PORTIONS;
  global.inferPremiumContext = inferContext;
  global.getPremiumContextCompatibility = compatibility;
  global.getPremiumPortionDecision = portionDecision;
  global.getPremiumPreparationUses = preparationUses;
  global.getPremiumUsagePromptOptions = usagePromptOptions;
  global.getPremiumUsageCompatibility = usageCompatibility;
})(typeof window !== "undefined" ? window : globalThis);
