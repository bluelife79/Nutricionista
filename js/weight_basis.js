(function initWeightBasis(global) {
  "use strict";

  var VERSION = "premium-v2.4-weight-basis-1";
  var LABELS = {
    raw: "en crudo",
    cooked: "cocinado",
    drained: "peso escurrido",
    dry: "en seco",
    as_sold: "tal como viene",
  };

  function bridgeFor(originFood, candidateFood) {
    if (!originFood || !candidateFood) return null;
    var originBasis = String(originFood.weight_basis || "");
    var candidateBasis = String(candidateFood.weight_basis || "");
    if (!originBasis || !candidateBasis || originBasis === candidateBasis) {
      return null;
    }
    var context =
      typeof global.inferPremiumContext === "function"
        ? global.inferPremiumContext(originFood)
        : String(originFood.premium_context || "");
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
  global.getPremiumWeightBasisCompatibility = compatibility;
})(typeof window !== "undefined" ? window : globalThis);
