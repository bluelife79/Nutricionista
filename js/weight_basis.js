(function initWeightBasis(global) {
  "use strict";

  var VERSION = "premium-v2.5-weight-basis-1";
  var LABELS = {
    raw: "en crudo",
    cooked: "cocinado",
    drained: "peso escurrido",
    dry: "en seco",
    as_sold: "tal como viene",
  };
  var STRICT_RAW_COOKED_CONTEXTS = new Set([
    "lean_meat",
    "fatty_meat",
    "minced_meat",
    "processed_meat",
    "egg",
    "white_fish",
    "fatty_fish",
    "processed_fish",
    "seafood",
    "organ_meat",
    "leafy_vegetable",
    "cruciferous",
    "fruiting_vegetable",
    "root_vegetable",
    "stalk_vegetable",
    "other_vegetable",
  ]);

  function contextOf(food) {
    return typeof global.inferPremiumContext === "function"
      ? global.inferPremiumContext(food)
      : String((food && food.premium_context) || "");
  }

  function isStrictRawCookedMismatch(originFood, candidateFood) {
    var bases = new Set([
      String((originFood && originFood.weight_basis) || ""),
      String((candidateFood && candidateFood.weight_basis) || ""),
    ]);
    if (!(bases.has("raw") && bases.has("cooked"))) return false;
    return (
      STRICT_RAW_COOKED_CONTEXTS.has(contextOf(originFood)) ||
      STRICT_RAW_COOKED_CONTEXTS.has(contextOf(candidateFood))
    );
  }

  function bridgeFor(originFood, candidateFood) {
    if (!originFood || !candidateFood) return null;
    var originBasis = String(originFood.weight_basis || "");
    var candidateBasis = String(candidateFood.weight_basis || "");
    if (!originBasis || !candidateBasis || originBasis === candidateBasis) {
      return null;
    }
    // Carne, pescado, huevo y verdura simple no pueden cruzar crudo/cocinado:
    // la diferencia de agua hace que comparar los gramos sea engañoso.
    if (isStrictRawCookedMismatch(originFood, candidateFood)) return null;
    var context = contextOf(originFood);
    var config = global.PREMIUM_WEIGHT_BASIS_BRIDGES || {};
    return (config.bridges || []).find(function (bridge) {
      var directions =
        (bridge.from === originBasis && bridge.to === candidateBasis) ||
        (bridge.to === originBasis && bridge.from === candidateBasis);
      return directions && (bridge.contexts || []).includes(context);
    }) || null;
  }

  function compatibility(originFood, candidateFood) {
    var originBasis = String((originFood && originFood.weight_basis) || "");
    var candidateBasis = String(
      (candidateFood && candidateFood.weight_basis) || "",
    );
    if (!originBasis || !candidateBasis) {
      return {
        compatible: false,
        reason: "missing_weight_basis",
        bridge: null,
      };
    }
    if (originBasis === candidateBasis) {
      return {
        compatible: true,
        reason: "same_weight_basis",
        bridge: null,
      };
    }
    var bridge = bridgeFor(originFood, candidateFood);
    return {
      compatible: Boolean(bridge),
      reason: bridge ? "declared_weight_basis_bridge" : "weight_basis_mismatch",
      bridge: bridge,
    };
  }

  global.PREMIUM_WEIGHT_BASIS_VERSION = VERSION;
  global.PREMIUM_WEIGHT_BASIS_LABELS = LABELS;
  global.getPremiumWeightBasisLabel = function (food) {
    return LABELS[String((food && food.weight_basis) || "")] || "";
  };
  global.isPremiumStrictRawCookedMismatch = isStrictRawCookedMismatch;
  global.getPremiumWeightBasisCompatibility = compatibility;
})(typeof window !== "undefined" ? window : globalThis);
