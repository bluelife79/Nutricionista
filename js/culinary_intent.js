/**
 * Premium 2.2 — adaptive culinary intent.
 *
 * The exchange engine remains nutritional and deterministic. This layer adds
 * a small, structured question only when a food has genuinely different
 * culinary uses and the current catalogue contains useful candidates for
 * more than one of them.
 *
 * It deliberately models reusable food families instead of individual
 * questionnaires. New catalogue rows inherit a profile from their context,
 * subgroup and name, so coverage does not depend on remembering to maintain a
 * second hand-written list of product IDs.
 */
(function (global) {
  "use strict";

  var VERSION = "premium-v2.2-intent-3";
  var MIN_CANDIDATES_PER_OPTION = 3;
  var PROFILE_CACHE = typeof WeakMap === "function" ? new WeakMap() : null;
  var CATALOG_USE_INDEX = typeof WeakMap === "function" ? new WeakMap() : null;
  var COMPATIBLE_MODE_CACHE =
    typeof WeakMap === "function" ? new WeakMap() : null;

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

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function contextOf(food) {
    return typeof global.inferPremiumContext === "function"
      ? global.inferPremiumContext(food)
      : "unknown";
  }

  function profile(food) {
    if (
      PROFILE_CACHE &&
      food &&
      typeof food === "object" &&
      PROFILE_CACHE.has(food)
    ) {
      return PROFILE_CACHE.get(food);
    }
    if (
      food &&
      food.culinary_intent &&
      food.culinary_intent.version === VERSION &&
      food.culinary_intent.family &&
      Array.isArray(food.culinary_intent.uses) &&
      Array.isArray(food.culinary_intent.primary_uses)
    ) {
      var storedResult = {
        version: VERSION,
        family: food.culinary_intent.family,
        uses: food.culinary_intent.uses.slice(),
        primary_uses: food.culinary_intent.primary_uses.slice(),
        prompt_id: food.culinary_intent.prompt_id || null,
        confidence:
          food.culinary_intent.validation_status === "release_validated"
            ? "release_validated"
            : "not_prompted",
      };
      if (PROFILE_CACHE && typeof food === "object") {
        PROFILE_CACHE.set(food, storedResult);
      }
      return storedResult;
    }
    var name = normalize(food && food.name);
    var context = contextOf(food);
    var subgroup = String((food && food.subgroup) || "").toLowerCase();
    var uses = [];
    var family = context;
    var promptId = null;

    if (["fresh_cheese", "aged_cheese"].includes(context)) {
      if (hasAny(name, [
        /\bcon frut\w*\b/, /\btrocitos? de fresa\b/,
        /\bsabor (fresa|frambuesa|mango)\b/,
      ])) {
        family = "sweet_dessert";
        uses.push("direct");
      } else {
        family = "cheese";
        promptId = "cheese_use";
      }
      if (family === "sweet_dessert") {
        // El uso del lácteo con fruta es postre, no queso para cocinar.
      } else if (hasAny(name, [
        /\b3 quesos\b/, /\brallad\w*\b/, /\bgratin\w*\b/,
        /\bfundir\b/, /\bprovolone\b/, /\bfundid\w*\b/,
        /\bespecial pasta\b/,
      ])) {
        uses.push("melt");
      } else if (hasAny(name, [/\bqueso finas hierbas\b/])) {
        uses.push("spread");
      } else if (hasAny(name, [/\bqueso light\b/])) {
        uses.push("direct");
      } else if (hasAny(name, [/\bqueso blanco pasteurizado\b/])) {
        uses.push("cold");
      } else if (hasAny(name, [
        /\buntar\b/, /\bcremos\w*\b/, /\bcrema de queso\b/,
        /\bqueso crema\b/, /\bmascarpone\b/, /\bfrischkase\b/,
      ])) {
        uses.push("spread");
        if (hasAny(name, [/\bmascarpone\b/])) uses.push("baking");
      } else if (hasAny(name, [/\btabla de quesos\b/, /\bminiqueso\b/])) {
        uses.push("direct");
      } else if (hasAny(name, [/\bquesitos?\b/])) {
        uses.push("spread", "cold");
      } else if (hasAny(name, [/\bmozzarella\b/, /\bmozzarela\b/, /\bburrata\b/])) {
        uses.push("cold", "melt");
      } else if (hasAny(name, [/\bburgos\b/, /\brequeson\b/, /\bricotta\b/, /\bcottage\b/, /\bfeta\b/, /\bmato\b/, /\bqueso fresco\b/])) {
        uses.push("cold", "spread");
      } else if (context === "aged_cheese") {
        uses.push("direct", "melt");
      } else {
        uses.push("cold", "melt", "spread");
      }
    } else if (context === "breakfast_cereal") {
      family = "cereal";
      if (hasAny(name, [/\bavena\b/, /\bcopo\w*\b/, /\bsalvado\b/, /\bporridge\b/])) {
        promptId = "oats_use";
        uses.push("breakfast_bowl", "porridge", "baking");
        if (!hasAny(name, [/\bchocolate\b/, /\bazucar\w*\b/, /\bmiel\b/, /\brellen\w*\b/])) {
          uses.push("savory");
        }
      } else {
        uses.push("breakfast_bowl");
      }
    } else if (["dry_grain", "cooked_grain"].includes(context)) {
      family = "grain";
      uses.push("savory");
    } else if (context === "baking_input") {
      family = "baking_input";
      uses.push("baking");
    } else if (context === "bread") {
      family = "bread";
      promptId = "bread_use";
      if (hasAny(name, [/\bwrap\w*\b/, /\btortilla\w* de (trigo|maiz)\b/])) {
        uses.push("wrap", "sandwich");
      } else if (hasAny(name, [/\bpita\b/])) {
        uses.push("sandwich", "wrap");
      } else if (hasAny(name, [/\btostad\w*\b/, /\bbiscot\w*\b/])) {
        uses.push("toast");
      } else {
        uses.push("toast", "sandwich");
      }
    } else if (["lean_meat", "fatty_meat", "minced_meat"].includes(context)) {
      family = "meat";
      promptId = "meat_use";
      if (hasAny(name, [/\bcabecero de lomo\b/])) {
        uses.push("main_piece");
      } else if (context === "minced_meat" || hasAny(name, [/\bpicad\w*\b/, /\bhamburgues\w*\b/])) {
        uses.push("minced", "stew");
      } else if (hasAny(name, [/\bguis\w*\b/, /\bestofad\w*\b/, /\brag[uú]\b/])) {
        uses.push("stew");
      } else if (hasAny(name, [/\btiras?\b/, /\btacos?\b/, /\bdados?\b/])) {
        uses.push("stew", "main_piece");
      } else {
        uses.push("main_piece", "stew");
      }
    } else if (["white_fish", "fatty_fish", "seafood"].includes(context)) {
      family = "fish";
      promptId = "fish_use";
      if (hasAny(name, [/\bcaracol\w*\b/])) {
        uses.push("stew");
      } else if (hasAny(name, [/\bguis\w*\b/, /\bcalderet\w*\b/, /\bsopa\b/])) {
        uses.push("stew");
      } else {
        uses.push("main_piece", "stew");
      }
    } else if (context === "canned_fish") {
      family = "fish";
      uses.push("cold", "sandwich");
    } else if (context === "plant_protein") {
      family = "plant_protein";
      promptId = "plant_protein_use";
      if (hasAny(name, [/\bhamburgues\w*\b/])) {
        uses.push("main_piece");
      } else if (hasAny(name, [/\btexturizad\w*\b/, /\bpicad\w*\b/, /\bgranulad\w*\b/])) {
        uses.push("minced", "stew");
      } else {
        uses.push("main_piece", "stew");
        if (hasAny(name, [/\btofu\b/, /\btempeh\b/])) uses.push("minced");
      }
    } else if (context === "cooked_legume") {
      family = "legume";
      promptId = "legume_use";
      if (hasAny(name, [/\bensalada\b/])) {
        uses.push("salad");
      } else if (hasAny(name, [/\bguis\w*\b/, /\bcocid\w*\b/, /\bfabad\w*\b/, /\bpotaje\b/])) {
        uses.push("stew");
      } else {
        uses.push("stew", "salad");
      }
    } else if (["tuber", "cooked_tuber"].includes(context)) {
      family = "tuber";
      promptId = "tuber_use";
      if (hasAny(name, [/\bpure\b/])) {
        uses.push("puree");
      } else if (hasAny(name, [/\bfrit\w*\b/, /\bchips?\b/])) {
        uses.push("fry");
      } else if (hasAny(name, [/\bguis\w*\b/, /\bestofad\w*\b/])) {
        uses.push("stew");
      } else {
        uses.push("side", "stew", "puree");
      }
    } else if (context === "fermented_dairy") {
      family = "fermented_dairy";
      if (hasAny(name, [/\bkefir\b/, /\bbebible\b/, /\bpara beber\b/, /\bliquido\b/])) {
        uses.push("drink");
      } else {
        uses.push("spoon");
        var flavoredFermented = hasAny(name, [
          /\bfresa\w*\b/, /\bmango\b/, /\bframbues\w*\b/, /\bfrut\w*\b/,
          /\blimon\b/, /\bvainilla\b/, /\bchocolate\b/, /\bcereales?\b/,
          /\bmuesli\b/, /\bnueces?\b/, /\barandanos?\b/, /\bmiel\b/,
        ]);
        if (
          !flavoredFermented &&
          hasAny(name, [/\bnatural\b/, /\bgrieg\w*\b/, /\bskyr\b/, /\bquark\b/])
        ) {
          promptId = "fermented_dairy_use";
          uses.push("cooking_sauce");
        }
      }
    } else if (
      ["leafy_vegetable", "cruciferous", "fruiting_vegetable", "root_vegetable", "stalk_vegetable", "other_vegetable"].includes(context)
    ) {
      family = "vegetable";
      if (hasAny(name, [/\bpepinos?\b/])) {
        uses.push("salad");
      } else if (hasAny(name, [/\bencurtid\w*\b/, /\bvinagre\b/])) {
        uses.push("cold");
      } else if (subgroup === "allium" || hasAny(name, [
        /\bajo\b/, /\bcebolla\b/, /\bchalota\b/, /\bechalote\b/,
      ])) {
        uses.push("cooking");
      } else if (hasAny(name, [/\bpure\b/, /\bcrema\b/, /\bsopa\b/])) {
        uses.push("soup");
      } else if (hasAny(name, [/\bensalada\b/, /\bcrud[oa]\b/])) {
        uses.push("salad");
      } else {
        promptId = "vegetable_use";
        uses.push("cooked_side", "soup");
        if (["leafy_vegetable", "fruiting_vegetable", "root_vegetable", "stalk_vegetable"].includes(context)) {
          uses.push("salad");
        }
      }
    } else if (context === "milk" || context === "plant_drink") {
      family = "milk_drink";
      uses.push("drink", "breakfast_bowl");
    } else if (context === "egg") {
      family = "egg";
      uses.push("main_piece", "cooking");
    } else if (context === "nuts_seeds") {
      family = "nuts_seeds";
      uses.push("direct", "topping");
    } else if (context === "nut_spread") {
      family = "spread";
      uses.push("spread");
    } else if (context === "oil") {
      family = subgroup === "butter_margarine" ? "spreadable_fat" : "oil";
      if (subgroup === "butter_margarine") {
        promptId = "spreadable_fat_use";
        uses.push("spread", "cooking");
      } else {
        uses.push("dressing", "cooking");
      }
    } else if (context === "whole_fruit") {
      family = "fruit";
      uses.push("direct");
    } else if (context === "fruit_beverage") {
      family = "fruit_beverage";
      uses.push("drink");
    } else if (context === "savory_sauce" || context === "condiment") {
      family = context;
      uses.push("cooking_sauce");
    } else if (context === "sweet_bakery" || context === "sweet_dessert") {
      family = context;
      uses.push("direct");
    } else if (context === "prepared_meal" || context === "cold_soup") {
      family = context;
      uses.push("meal");
    } else {
      uses.push("any");
    }

    var primaryUses = [];
    if (family === "cheese") {
      if (hasAny(name, [/\btabla de quesos\b/, /\bminiqueso\b/])) {
        primaryUses.push("direct");
      } else if (hasAny(name, [
        /\brallad\w*\b/, /\blonchas?\b/, /\bgratin\w*\b/,
        /\bfundir\b/, /\bprovolone\b/, /\bespecial pasta\b/,
        /\b3 quesos\b/,
      ])) {
        primaryUses.push("melt");
      } else if (hasAny(name, [
        /\buntar\b/, /\bcremos\w*\b/, /\bcrema de queso\b/,
        /\bqueso crema\b/, /\bmascarpone\b/, /\bfrischkase\b/,
        /\bquesitos?\b/,
      ])) {
        primaryUses.push("spread");
      } else if (hasAny(name, [
        /\bmini\b/, /\bperlas?\b/, /\bburrata\b/,
        /\bmozzare?lla fresca\b/, /\bmozzarela fresca\b/,
      ])) {
        primaryUses.push("cold");
      } else if (hasAny(name, [/\bmozzarella\b/, /\bmozzarela\b/, /\bburrata\b/])) {
        primaryUses.push("cold", "melt");
      } else if (context === "aged_cheese") {
        primaryUses.push("direct");
      } else {
        primaryUses.push("cold");
      }
    } else if (family === "cereal") {
      if (hasAny(name, [/\bharina\b/, /\bmolid\w*\b/])) {
        primaryUses.push("baking");
      } else if (hasAny(name, [/\bporridge\b/])) {
        primaryUses.push("porridge");
      } else if (hasAny(name, [/\bmuesli\b/, /\bgranola\b/, /\bchocolate\b/, /\brellen\w*\b/])) {
        primaryUses.push("breakfast_bowl");
      } else {
        primaryUses.push("breakfast_bowl", "porridge");
      }
    } else if (family === "meat") {
      if (uses.includes("minced")) {
        primaryUses.push("minced");
      } else if (hasAny(name, [/\bguis\w*\b/, /\bestofad\w*\b/, /\brag[uú]\b/, /\btiras?\b/, /\btacos?\b/, /\bdados?\b/, /\bmorcillo\b/, /\bjarrete\b/])) {
        primaryUses.push("stew");
      } else {
        primaryUses.push("main_piece");
      }
    } else if (family === "fish") {
      primaryUses.push(
        context === "seafood" ||
        hasAny(name, [
          /\bguis\w*\b/, /\bcalderet\w*\b/, /\bsopa\b/, /\btrozos?\b/,
          /\bdados?\b/, /\banillas?\b/, /\bcolas?\b/,
        ])
          ? "stew"
          : uses.includes("main_piece") ? "main_piece" : uses[0],
      );
    } else if (family === "plant_protein") {
      primaryUses.push(
        hasAny(name, [/\btexturizad\w*\b/, /\bpicad\w*\b/, /\bgranulad\w*\b/])
          ? "minced"
          : "main_piece",
      );
    } else if (family === "legume") {
      if (hasAny(name, [/\bensalada\b/])) primaryUses.push("salad");
      else if (hasAny(name, [/\bguis\w*\b/, /\bcocid\w*\b/, /\bfabad\w*\b/, /\bpotaje\b/])) primaryUses.push("stew");
      else primaryUses.push("stew", "salad");
    } else if (family === "tuber") {
      if (hasAny(name, [/\bpure\b/])) primaryUses.push("puree");
      else if (hasAny(name, [/\bfrit\w*\b/, /\bchips?\b/])) primaryUses.push("fry");
      else if (hasAny(name, [/\bguis\w*\b/, /\bestofad\w*\b/])) primaryUses.push("stew");
      else primaryUses.push("side", "stew");
    } else if (family === "fermented_dairy") {
      if (uses.includes("drink")) primaryUses.push("drink");
      else if (hasAny(name, [/\bgrieg\w*\b/, /\bquark\b/])) primaryUses.push("spoon", "cooking_sauce");
      else primaryUses.push("spoon");
    } else if (family === "vegetable") {
      if (hasAny(name, [/\bpure\b/, /\bcrema\b/, /\bsopa\b/])) primaryUses.push("soup");
      else if (hasAny(name, [/\bensalada\b/, /\bcrud[oa]\b/]) || context === "leafy_vegetable") primaryUses.push("salad");
      else primaryUses.push("cooked_side");
    } else if (family === "bread") {
      if (uses.includes("wrap")) primaryUses.push("wrap");
      else if (uses.length === 1 && uses[0] === "toast") primaryUses.push("toast");
      else primaryUses.push("toast", "sandwich");
    } else {
      primaryUses = uses.slice();
    }

    var result = {
      version: VERSION,
      family: family || "unclassified",
      uses: unique(uses),
      primary_uses: unique(
        (primaryUses.length > 0 ? primaryUses : uses).filter(function (use) {
          return uses.includes(use);
        }),
      ),
      prompt_id: promptId,
      confidence: promptId ? "rule_high" : "not_prompted",
    };
    if (PROFILE_CACHE && food && typeof food === "object") {
      PROFILE_CACHE.set(food, result);
    }
    return result;
  }

  var PROMPTS = {
    cheese_use: {
      question: "¿Cómo lo vas a utilizar?",
      help: "Así priorizamos quesos que funcionen de verdad en ese plato.",
      options: [
        { id: "cold", label: "En frío o ensalada", icon: "🥗" },
        { id: "melt", label: "Para fundir o gratinar", icon: "🔥" },
        { id: "spread", label: "Para untar", icon: "🥖" },
        { id: "direct", label: "En tabla, bocadillo o directamente", icon: "🧀" },
      ],
    },
    oats_use: {
      question: "¿Cómo vas a tomar la avena?",
      help: "No es lo mismo un desayuno de cuchara que una preparación salada.",
      options: [
        { id: "breakfast_bowl", label: "Desayuno con leche o yogur", icon: "🥣" },
        { id: "porridge", label: "Porridge", icon: "🥄" },
        { id: "baking", label: "Tortitas o repostería", icon: "🥞" },
        { id: "savory", label: "Preparación salada", icon: "🍲" },
      ],
    },
    bread_use: {
      question: "¿Para qué quieres el pan?",
      help: "El formato adecuado suele ser más útil que una equivalencia genérica.",
      options: [
        { id: "toast", label: "Tostada", icon: "🍞" },
        { id: "sandwich", label: "Bocadillo o sándwich", icon: "🥪" },
        { id: "wrap", label: "Para rellenar o enrollar", icon: "🌯" },
      ],
    },
    meat_use: {
      question: "¿Cómo vas a preparar la carne?",
      help: "Priorizamos alternativas que ocupen el mismo papel en tu comida.",
      options: [
        { id: "main_piece", label: "Filete o pieza principal", icon: "🍽️" },
        { id: "stew", label: "Guiso, tacos o salteado", icon: "🍲" },
        { id: "minced", label: "Picada, hamburguesa o relleno", icon: "🥘" },
      ],
    },
    fish_use: {
      question: "¿Cómo vas a preparar el pescado?",
      help: "Separamos una pieza principal de pescados pensados para guiso.",
      options: [
        { id: "main_piece", label: "Filete o pieza principal", icon: "🐟" },
        { id: "stew", label: "Guiso, sopa o arroz", icon: "🍲" },
      ],
    },
    plant_protein_use: {
      question: "¿Cómo vas a usar la proteína vegetal?",
      help: "Priorizamos formatos que puedas cocinar de la misma manera.",
      options: [
        { id: "main_piece", label: "Plancha o pieza principal", icon: "🍽️" },
        { id: "stew", label: "Guiso o salteado", icon: "🍲" },
        { id: "minced", label: "Picada, relleno o salsa", icon: "🥘" },
      ],
    },
    legume_use: {
      question: "¿Cómo vas a preparar la legumbre?",
      help: "La alternativa cambia si buscas un plato de cuchara o algo frío.",
      options: [
        { id: "stew", label: "Guiso o plato de cuchara", icon: "🍲" },
        { id: "salad", label: "Ensalada o plato frío", icon: "🥗" },
      ],
    },
    tuber_use: {
      question: "¿Cómo quieres utilizarlo?",
      help: "Priorizamos tubérculos y formatos adecuados para esa preparación.",
      options: [
        { id: "side", label: "Guarnición", icon: "🍽️" },
        { id: "stew", label: "Guiso", icon: "🍲" },
        { id: "puree", label: "Puré o crema", icon: "🥣" },
        { id: "fry", label: "Para freír", icon: "🍟" },
      ],
    },
    fermented_dairy_use: {
      question: "¿Cómo quieres utilizarlo?",
      help: "Distinguimos tomarlo directamente de usarlo en una receta o salsa.",
      options: [
        { id: "spoon", label: "Para tomar con cuchara", icon: "🥄" },
        { id: "cooking_sauce", label: "Para cocinar o hacer una salsa", icon: "🥣" },
        { id: "drink", label: "Para beber", icon: "🥛" },
      ],
    },
    vegetable_use: {
      question: "¿Cómo vas a preparar la verdura?",
      help: "La textura y la forma de cocinarla importan en el intercambio.",
      options: [
        { id: "salad", label: "Cruda o en ensalada", icon: "🥗" },
        { id: "cooked_side", label: "Cocinada o como guarnición", icon: "🍽️" },
        { id: "soup", label: "Crema, puré o sopa", icon: "🥣" },
      ],
    },
    spreadable_fat_use: {
      question: "¿Cómo la vas a utilizar?",
      help: "Diferenciamos una grasa para untar de una grasa para cocinar.",
      options: [
        { id: "spread", label: "Para untar", icon: "🥖" },
        { id: "cooking", label: "Para cocinar", icon: "🍳" },
      ],
    },
  };

  function useIndex(catalog) {
    if (
      CATALOG_USE_INDEX &&
      Array.isArray(catalog) &&
      CATALOG_USE_INDEX.has(catalog)
    ) {
      return CATALOG_USE_INDEX.get(catalog);
    }
    var index = {};
    (Array.isArray(catalog) ? catalog : []).forEach(function (candidate) {
      if (!candidate) return;
      profile(candidate).uses.forEach(function (use) {
        if (!index[use]) index[use] = [];
        index[use].push(candidate);
      });
    });
    if (CATALOG_USE_INDEX && Array.isArray(catalog)) {
      CATALOG_USE_INDEX.set(catalog, index);
    }
    return index;
  }

  function candidateIdsForMode(originFood, mode, catalog) {
    var originId = String((originFood && originFood.id) || "");
    var context = contextOf(originFood);
    var cacheForCatalog = null;
    var cacheKey = context + "|" + mode;
    if (COMPATIBLE_MODE_CACHE && Array.isArray(catalog)) {
      cacheForCatalog = COMPATIBLE_MODE_CACHE.get(catalog);
      if (!cacheForCatalog) {
        cacheForCatalog = {};
        COMPATIBLE_MODE_CACHE.set(catalog, cacheForCatalog);
      }
    }
    var compatibleIds =
      cacheForCatalog && cacheForCatalog[cacheKey]
        ? cacheForCatalog[cacheKey]
        : (useIndex(catalog)[mode] || [])
      .filter(function (candidate) {
        if (!candidate) return false;
        if (candidate.quality_status === "quarantine") return false;
        if ((candidate.flags || []).includes("hidden")) return false;
        if (!candidate.subgroup || candidate.subgroup === "?") return false;
        if (
          typeof global.isPremiumExchangeCandidateEligible === "function" &&
          !global.isPremiumExchangeCandidateEligible(candidate, originFood)
        ) {
          return false;
        }
        if (
          typeof global.getPremiumContextCompatibility === "function" &&
          !global.getPremiumContextCompatibility(originFood, candidate).compatible
        ) {
          return false;
        }
        return profile(candidate).uses.includes(mode);
      })
      .map(function (candidate) {
        return String(candidate.id);
      });
    if (cacheForCatalog && !cacheForCatalog[cacheKey]) {
      cacheForCatalog[cacheKey] = compatibleIds;
    }
    return compatibleIds.filter(function (candidateId) {
      return candidateId !== originId;
    });
  }

  function symmetricDifferenceSize(a, b) {
    var left = new Set(a);
    var right = new Set(b);
    var count = 0;
    left.forEach(function (value) {
      if (!right.has(value)) count += 1;
    });
    right.forEach(function (value) {
      if (!left.has(value)) count += 1;
    });
    return count;
  }

  function promptFor(food, catalog) {
    var foodProfile = profile(food);
    var template = PROMPTS[foodProfile.prompt_id];
    if (!template) return null;
    var validatedModes =
      food &&
      food.culinary_intent &&
      food.culinary_intent.version === VERSION &&
      food.culinary_intent.validation_status === "release_validated"
        ? food.culinary_intent.validated_modes
        : null;

    var available = template.options
      .filter(function (option) {
        return foodProfile.uses.includes(option.id) &&
          (!validatedModes || validatedModes.includes(option.id));
      })
      .map(function (option) {
        return {
          id: option.id,
          label: option.label,
          icon: option.icon,
          candidate_ids: candidateIdsForMode(food, option.id, catalog),
        };
      })
      .filter(function (option) {
        return option.candidate_ids.length >= MIN_CANDIDATES_PER_OPTION;
      });

    if (available.length < 2) return null;
    var materiallyDifferent = false;
    for (var i = 0; i < available.length && !materiallyDifferent; i += 1) {
      for (var j = i + 1; j < available.length; j += 1) {
        if (symmetricDifferenceSize(
          available[i].candidate_ids,
          available[j].candidate_ids,
        ) >= MIN_CANDIDATES_PER_OPTION) {
          materiallyDifferent = true;
          break;
        }
      }
    }
    if (!materiallyDifferent) return null;

    return {
      id: foodProfile.prompt_id,
      question: template.question,
      help: template.help,
      options: available.map(function (option) {
        return { id: option.id, label: option.label, icon: option.icon };
      }).concat([{ id: "any", label: "Me da igual", icon: "" }]),
    };
  }

  function usageCompatibility(candidateFood, requestedUse) {
    if (!requestedUse || requestedUse === "any") {
      return {
        compatible: true,
        requested: "any",
        candidateUses: profile(candidateFood).uses,
      };
    }
    var candidateProfile = profile(candidateFood);
    return {
      compatible: candidateProfile.uses.includes("any") ||
        candidateProfile.uses.includes(requestedUse),
      requested: requestedUse,
      candidateUses: candidateProfile.uses,
      priority: candidateProfile.primary_uses.includes(requestedUse) ? 0 : 1,
    };
  }

  global.PREMIUM_INTENT_VERSION = VERSION;
  global.PREMIUM_INTENT_PROMPTS = PROMPTS;
  global.getPremiumIntentProfile = profile;
  global.getPremiumUsagePrompt = promptFor;
  global.getPremiumUsageCompatibility = usageCompatibility;
  global.getPremiumUsagePromptOptions = function (food, catalog) {
    var prompt = promptFor(food, catalog || global.foodsDatabase || []);
    return prompt ? prompt.options.map(function (option) { return option.id; }) : [];
  };
})(typeof window !== "undefined" ? window : globalThis);
