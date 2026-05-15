// =============================================================================
// DIETARY FILTERS — vegetariano / sin lactosa (derivables del schema)
// =============================================================================
//
// Audit punto 13 — fase 2 del cliente. Implementamos SOLO los filtros que
// podemos derivar del schema actual (category/subgroup/name). Sin gluten y
// "alto en fibra" / saciedad quedan fuera porque la DB no tiene `fiber` ni
// flag de gluten — requieren un pase de bulk-label aparte.
//
// API:
//   isVegetarian(food)   → boolean
//   isLactoseFree(food)  → boolean
//   passesDietaryFilters(food, activeFilters) → boolean
//
//   activeFilters: Set<string> o array de {"vegetarian","lactose_free"}.
//   Vacío / null → no filter, pasa todo.
//
// Lectura ON-CALL: el algoritmo lee `window.DIETARY_FILTERS` justo antes
// de filtrar candidatos, así toggles del UI tienen efecto sin reload.
// =============================================================================

(function () {
  "use strict";

  const _MEAT_FISH_SUBGROUPS = new Set([
    "meat",
    "fish",
    "processed_meat",
    "processed_protein",
    "meat_lean",
    "meat_fatty",
    "fish_white",
    "fish_fatty",
    "viscera",
  ]);

  // Keywords that signal meat/fish even when category mislabels them
  // (rare but real — e.g. some prepared dishes get category=other).
  const _MEAT_FISH_NAME_RE = /\b(pollo|pavo|ternera|cerdo|jamon|jamón|chorizo|salchicha|salami|bacon|panceta|lomo|solomillo|cordero|conejo|pescado|merluza|salmon|atun|atún|bonito|sardina|caballa|bacalao|trucha|lubina|dorada|rape|gambas?|langostino|marisco|sepia|pulpo|calamar|nécora|necora|mejillon|mejillón|almeja|chipirones?|carne)\b/i;

  function _norm(s) {
    if (!s) return "";
    return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function isVegetarian(food) {
    if (!food) return true;
    const cat = food.category;
    const sub = food.subgroup;
    if (cat === "protein" && _MEAT_FISH_SUBGROUPS.has(sub)) return false;
    if (sub && _MEAT_FISH_SUBGROUPS.has(sub)) return false;
    // Last-resort: keyword check on name. Catches "Lasaña de carne" that
    // sits in category=other for being prepared.
    if (_MEAT_FISH_NAME_RE.test(food.name || "")) return false;
    return true;
  }

  function isLactoseFree(food) {
    if (!food) return true;
    // Explicit "sin lactosa" wins: trust the product label.
    const name = _norm(food.name || "");
    if (/\bsin lactosa\b|\blactose[- ]?free\b|\b0%\s*lactosa\b/.test(name)) {
      return true;
    }
    // Anything in the dairy category is excluded by default.
    if (food.category === "dairy") return false;
    // Hidden dairy ingredients in non-dairy categories: be conservative
    // and only flag the obvious ones. Avoid false positives like "café
    // con leche" (already moved to category=other but contains milk).
    if (/\bleche\b|\byogur|\bqueso\b|\bnata\b|\bmantequilla\b/.test(name)) {
      // Only block if not explicitly vegetal substitute.
      if (!/\bvegetal|\bsoja|\balmendra|\bavena|\bcoco\b/.test(name)) {
        return false;
      }
    }
    return true;
  }

  function passesDietaryFilters(food, activeFilters) {
    if (!activeFilters) return true;
    // Accept Set or array
    const set = activeFilters instanceof Set
      ? activeFilters
      : new Set(activeFilters);
    if (set.size === 0) return true;
    if (set.has("vegetarian")   && !isVegetarian(food))  return false;
    if (set.has("lactose_free") && !isLactoseFree(food)) return false;
    return true;
  }

  // Export
  if (typeof window !== "undefined") {
    window.isVegetarian        = isVegetarian;
    window.isLactoseFree       = isLactoseFree;
    window.passesDietaryFilters = passesDietaryFilters;
  }
  if (typeof module !== "undefined") {
    module.exports = { isVegetarian, isLactoseFree, passesDietaryFilters };
  }
})();
