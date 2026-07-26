// =============================================================================
// HOUSEHOLD MEASURES — gramos → equivalencia casera práctica
// =============================================================================
//
// El cliente (audit punto 12) pidió: cuando tenga sentido, mostrar al lado del
// gramaje una referencia tipo "1 cucharada sopera", "2 huevos medianos",
// "1 puñadito de nueces". El cliente NO quiere que sea perfecto para todos
// los 5322 foods — solo para los más habituales. Por eso esto es un lookup
// estático curado, no una llamada a LLM.
//
// Estrategia de matching (en orden de prioridad):
//   1. Match por keyword normalizado en el nombre del food (ej. "aceite de oliva")
//   2. Match por subgroup (fallback ej. "tubers" → "patata mediana")
//   3. null si no encontramos referencia útil
//
// Cada regla devuelve un objeto { unitGrams, singular, plural, allowFraction }
// y la función formatHouseholdMeasure() resuelve "≈ 1.5 cucharadas soperas"
// o "≈ ½ aguacate" según el caso.
//
// Filosofía: SIEMPRE conservador. Si hay duda, devolvemos null y la UI
// muestra solo gramos. Mejor sin medida casera que con una equivocada.
// =============================================================================

(function () {
  "use strict";

  function _norm(s) {
    if (!s) return "";
    return s.normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  }

  // ── Reglas por keyword (más específicas primero) ─────────────────────────────
  // Cada item: { match: regex sobre nombre normalizado, unitGrams, singular,
  //              plural, allowFraction (default true) }
  const KEYWORD_RULES = [
    // Líquidos / aceites (cucharada sopera = ~15g, cucharadita = ~5g)
    {
      match: /\baceite\b/,
      unitGrams: 15, singular: "cucharada sopera", plural: "cucharadas soperas",
      smallUnit: { unitGrams: 5, singular: "cucharadita", plural: "cucharaditas" },
    },
    { match: /\bmantequilla\b|\bmargarina\b/,
      unitGrams: 10, singular: "porción", plural: "porciones" },

    // Huevo entero (talla M ≈ 50g de huevo sin cáscara)
    { match: /\bhuevo\b(?!.*\b(?:clara|yema|tortilla|revuelto|frito)\b)/,
      unitGrams: 50, singular: "huevo M", plural: "huevos M", allowFraction: false },
    { match: /\bclara de huevo\b|\bclara,? de huevo\b/,
      unitGrams: 33, singular: "clara M", plural: "claras M", allowFraction: false },
    { match: /\byema de huevo\b|\byema,? de huevo\b/,
      unitGrams: 17, singular: "yema M", plural: "yemas M", allowFraction: false },

    // Frutos secos — puñadito (~20-25g)
    { match: /\b(?:nueces|nuez|almendras|avellanas|pistachos|anacardos|cacahuetes|maní)\b/,
      unitGrams: 25, singular: "puñadito", plural: "puñaditos" },

    // Aceitunas (~3-4g cada una)
    { match: /\baceituna/,
      unitGrams: 4, singular: "aceituna", plural: "aceitunas", allowFraction: false },

    // Aguacate (entero grande ≈ 150g de pulpa)
    { match: /\baguacate\b/,
      unitGrams: 150, singular: "aguacate", plural: "aguacates" },

    // Yogur (envase estándar 125g)
    { match: /\byogur\b|\byogurt\b|\byogures\b/,
      unitGrams: 125, singular: "yogur", plural: "yogures" },

    // Queso fresco / requesón (porción 30g)
    { match: /\bqueso fresco\b|\brequeson\b|\brequesón\b|\bburgos\b/,
      unitGrams: 30, singular: "porción", plural: "porciones" },

    // Pan (rebanada ≈ 30g)
    { match: /\bpan\b(?!.*\b(?:rallado|integral entero|de molde tostado)\b)/,
      unitGrams: 30, singular: "rebanada", plural: "rebanadas" },

    // Atún / sardinas en lata (lata escurrida ≈ 56-80g)
    { match: /\b(?:atun|atún|bonito|caballa)\b.*\b(?:lata|natural|aceite|escabeche)\b/,
      unitGrams: 56, singular: "lata pequeña", plural: "latas pequeñas" },
    { match: /\bsardina/,
      unitGrams: 40, singular: "sardina", plural: "sardinas", allowFraction: false },

    // Plátano / banana (mediano ≈ 120g)
    { match: /\bplatano\b|\bplátano\b|\bbanana\b/,
      unitGrams: 120, singular: "plátano", plural: "plátanos" },

    // Manzana / pera (mediana ≈ 180g)
    { match: /\bmanzana\b|\bpera\b/,
      unitGrams: 180, singular: "pieza mediana", plural: "piezas medianas" },

    // Naranja / mandarina (mediana ≈ 200g / 80g)
    { match: /\bmandarina\b|\bclementina\b/,
      unitGrams: 80, singular: "mandarina", plural: "mandarinas", allowFraction: false },
    { match: /\bnaranja\b/,
      unitGrams: 200, singular: "naranja", plural: "naranjas" },

    // Patata / boniato (mediana ≈ 200g)
    { match: /\bpatata\b|\bboniato\b/,
      unitGrams: 200, singular: "pieza mediana", plural: "piezas medianas" },

    // Legumbres cocidas en bote (~400g escurrido por bote)
    { match: /\b(?:garbanzos?|lentejas?|alubias?|judias? blancas|habas)\b.*\b(?:cocida|cocido|conserva|bote|en aceite)\b/,
      unitGrams: 200, singular: "½ bote", plural: "botes" },

    // Leche / bebidas vegetales (vaso ≈ 200ml ≈ 200g)
    { match: /\bleche\b(?!.*\b(?:condensada|evaporada|polvo)\b)/,
      unitGrams: 200, singular: "vaso", plural: "vasos" },

    // Pasta cruda (porción ≈ 80g)
    { match: /\bpasta\b.*\b(?:cruda|seca)\b|\bespagueti|\bmacarrones?\b.*\b(?:crudo|seco)\b/,
      unitGrams: 80, singular: "porción cruda", plural: "porciones crudas" },

    // Arroz crudo (porción ≈ 60g por persona)
    { match: /\barroz\b.*\b(?:crudo|seco)\b|^arroz, crudo$|^arroz$/,
      unitGrams: 60, singular: "porción cruda", plural: "porciones crudas" },
  ];

  // ── Reglas por subgroup (fallback genérico) ──────────────────────────────────
  const SUBGROUP_RULES = {
    nuts_seeds: { unitGrams: 25, singular: "puñadito", plural: "puñaditos" },
    eggs:       { unitGrams: 50, singular: "huevo M", plural: "huevos M", allowFraction: false },
  };

  // ── Fraction rendering ───────────────────────────────────────────────────────
  function _renderFraction(n) {
    // Cuando allowFraction y el ratio es 0.25/0.33/0.5/0.66/0.75 mostramos
    // glifos limpios — "≈ ½ aguacate" lee mejor que "≈ 0.5 aguacates".
    if (Math.abs(n - 0.25) < 0.06) return "¼";
    if (Math.abs(n - 0.33) < 0.06) return "⅓";
    if (Math.abs(n - 0.5)  < 0.06) return "½";
    if (Math.abs(n - 0.66) < 0.06) return "⅔";
    if (Math.abs(n - 0.75) < 0.06) return "¾";
    return n.toFixed(1);
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  // Returns a string like "≈ 1 cucharada sopera" or null if no rule matches.
  function formatHouseholdMeasure(food, grams) {
    if (!food || !grams || grams <= 0) return null;

    const name = _norm(food.name || "");
    let rule = null;

    // 1. Keyword rules (specific first — array order is the priority)
    for (const r of KEYWORD_RULES) {
      if (r.match.test(name)) { rule = r; break; }
    }

    // 2. Subgroup fallback
    if (!rule) {
      const sg = food.subgroup;
      if (sg && SUBGROUP_RULES[sg]) rule = SUBGROUP_RULES[sg];
    }

    if (!rule) return null;

    // Some rules have a "smallUnit" variant for tiny amounts (aceite con
    // 5g → cucharadita en vez de 0.3 cucharadas).
    if (rule.smallUnit && grams < rule.unitGrams * 0.7) {
      rule = rule.smallUnit;
    }

    const ratio = grams / rule.unitGrams;
    const allowFraction = rule.allowFraction !== false;

    // Reject extreme ratios — better no measure than a confusing one.
    if (ratio < 0.2 || ratio > 12) return null;

    if (ratio < 1 && allowFraction) {
      return `≈ ${_renderFraction(ratio)} ${rule.singular}`;
    }

    const rounded = Math.round(ratio);
    if (rounded <= 1) {
      return `≈ 1 ${rule.singular}`;
    }
    // Final clamp: tolerate ±20% off-grid; otherwise drop the suggestion.
    if (Math.abs(rounded - ratio) / ratio > 0.25) return null;
    return `≈ ${rounded} ${rule.plural}`;
  }

  // Export for browser + tests
  if (typeof window !== "undefined") {
    window.formatHouseholdMeasure = formatHouseholdMeasure;
  }
  if (typeof module !== "undefined") {
    module.exports = { formatHouseholdMeasure };
  }
})();
