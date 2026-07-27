(function initPresentationPolicy(global) {
  "use strict";

  const ROLE_FAMILY_FIRST = new Set(["snack", "dessert"]);
  const SUBGROUP_FAMILY_FIRST = new Set([
    "processed_meat",
    "sweets_bakery",
  ]);
  const TOKEN_FAMILY_FIRST = [
    "pan",
    "tostada",
    "biscote",
    "pico",
    "colin",
    "avena",
    "copos",
    "cereales",
    "muesli",
    "granola",
    "barrita",
    "all-bran",
    "all bran",
    "corn flakes",
    "fitness",
    "special k",
    "choco krispies",
    "galleta",
    "tortita",
    "cracker",
    "crujiente",
    "jamon",
    "jamón",
    "chorizo",
    "salchichon",
    "salchichón",
    "fuet",
    "salchicha",
    "hamburguesa",
    "bacon",
    "mortadela",
    "pavo cocido",
    "pollo cocido",
    "fiambre",
    "hummus",
    "tahin",
    "tahini",
    "pate",
    "paté",
    "mermelada",
    "confitura",
    "compota",
    "jalea",
    "zumo",
    "bebida vegetal",
    "leche",
    "horchata",
    "yogur",
    "yogurt",
    "yoghurt",
    "skyr",
    "fage",
    "quark",
    "kefir",
    "kéfir",
    "huevo",
    "tofu",
    "tempeh",
    "seitan",
    "seitán",
    "soja texturizada",
    "heura",
    "garbanzo",
    "alubia cocida",
    "lenteja cocida",
    "judia cocida",
    "judía cocida",
    "aceitun",
    "encurtido",
    "pepinillo",
    "chocolate",
    "tableta",
  ];

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function shouldShowFamilyFirst(originalFood, alternatives) {
    const runtime = global.REVOLUCIONAT_RUNTIME_CONFIG || {};
    if (runtime.familyFirstEnabled === false) return false;

    const role = originalFood?.culinary_role || "meal_dish";
    const category = originalFood?.category;
    const subgroup = originalFood?.subgroup;
    const normalizedName = normalize(originalFood?.name);
    const byClassification =
      ROLE_FAMILY_FIRST.has(role) ||
      category === "dairy" ||
      SUBGROUP_FAMILY_FIRST.has(subgroup);
    const byToken = TOKEN_FAMILY_FIRST.some((token) =>
      normalizedName.includes(normalize(token)),
    );
    const familyCount = alternatives?.familia?.length || 0;
    return (byClassification || byToken) && familyCount >= 5;
  }

  function getResultBlockOrder(originalFood, alternatives) {
    return shouldShowFamilyFirst(originalFood, alternatives)
      ? ["familia", "intercambios", "preparados"]
      : ["intercambios", "preparados", "familia"];
  }

  function getInitiallyVisibleResults(originalFood, alternatives) {
    const runtime = global.REVOLUCIONAT_RUNTIME_CONFIG || {};
    const directLimit = Number(runtime.resultBatchSize) || 8;
    const familyLimit = Number(runtime.familyVisibleLimit) || 6;
    const preparedLimit = Number(runtime.preparedVisibleLimit) || 8;
    const sources = {
      intercambios: (alternatives?.intercambios || []).slice(0, directLimit),
      familia: (alternatives?.familia || []).slice(0, familyLimit),
      preparados: (alternatives?.preparados || []).slice(0, preparedLimit),
    };
    return getResultBlockOrder(originalFood, alternatives).flatMap((block) =>
      sources[block].map((food) => ({ ...food, _block: block })),
    );
  }

  function getExpandableScrollOrder(originalFood, alternatives) {
    const runtime = global.REVOLUCIONAT_RUNTIME_CONFIG || {};
    const familyLimit = Number(runtime.familyVisibleLimit) || 6;
    const preparedLimit = Number(runtime.preparedVisibleLimit) || 8;
    const sources = {
      intercambios: alternatives?.intercambios || [],
      familia: (alternatives?.familia || []).slice(0, familyLimit),
      preparados: (alternatives?.preparados || []).slice(0, preparedLimit),
    };
    return getResultBlockOrder(originalFood, alternatives).flatMap((block) =>
      sources[block].map((food) => ({ ...food, _block: block })),
    );
  }

  global.shouldShowFamilyFirst = shouldShowFamilyFirst;
  global.getResultBlockOrder = getResultBlockOrder;
  global.getInitiallyVisibleResults = getInitiallyVisibleResults;
  global.getExpandableScrollOrder = getExpandableScrollOrder;
})(typeof window !== "undefined" ? window : globalThis);
