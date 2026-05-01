// ============================================
// algorithm.js — extracted & refactored from index.html
// Uses window.foodsDatabase (global, set after fetch in index.html)
// ============================================

// ============================================
// SEARCH HELPERS
// ============================================
const STOP_WORDS = new Set([
  "de","la","el","los","las","del","al","en","y","a","e","o","un","una",
  "con","sin","por","para","se","su","sus","le","les","lo","que","es","al",
]);

const API_URL = "http://localhost:8000";
const RERANK_TIMEOUT_MS = 500;
const MAX_CANDIDATES = 50;

function norm(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(query) {
  return norm(query)
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

function matchesFood(food, query) {
  const q = norm(query);
  if (!q) return true;

  const terms = q.split(/\s+/).filter(Boolean);
  const hay = norm(
    (food.name || "") +
      " " +
      (food.brand || "") +
      " " +
      (food.source || "") +
      " " +
      (food.category || ""),
  );

  return terms.every((t) => hay.includes(t));
}

// ============================================
// ANCHOR MACRO
// ============================================
function getAnchorMacro(food) {
  // macro_profile como fuente primaria si es un valor confiable
  const mp = (food.macro_profile || "").toLowerCase();
  if (mp === "protein") return "protein";
  if (mp === "carbs") return "carbs";
  if (mp === "fat") return "fat";
  // fallback a category
  const cat = (food.category || "").toLowerCase();
  if (cat === "protein" || cat === "postres_proteicos") return "protein";
  if (cat === "carbs") return "carbs";
  if (cat === "fat") return "fat";
  if (cat === "dairy") return "protein";
  return "calories";
}

// ============================================
// TIER CLASSIFICATION
// ============================================

// Palabras que NO identifican un ingrediente (solo describen estado, corte,
// marca, conservación, etc.). Las usamos para extraer el ingrediente real
// del nombre y comparar entre alimentos.
//
// Ejemplo: "Pechuga de pollo Mercadona"
//   - Quitar stop words: ["pechuga", "pollo", "mercadona"]
//   - Quitar non-ingredient: ["pollo"]   ← este es el ingrediente real
//
// Esto permite que "Pechuga de pollo Mercadona" + "Pollo asado" matcheen
// como T1 (familia, mismo ingrediente) en vez de quedar mal en T2.
const NON_INGREDIENT_TOKENS = new Set([
  // Estados de cocción
  "crudo", "cruda", "cocido", "cocida", "fresco", "fresca", "frescos", "frescas",
  "asado", "asada", "asados", "asadas", "plancha", "hervido", "hervida",
  "frito", "frita", "fritos", "fritas", "horneado", "horneada",
  "tostado", "tostada",
  // Piezas anatómicas (cortes — pollo, pavo, cerdo, ternera comparten muchos)
  "pechuga", "pechugas", "muslo", "muslos", "ala", "alas", "cuello",
  "lomo", "solomillo", "costilla", "costillas", "contramuslo", "jamoncillo",
  "falda", "cadera", "jarrete", "espalda", "paleta", "codillo",
  "chuleta", "chuletas", "chuleton", "entrecot", "escalope", "escalopines",
  "rabo", "morro", "oreja", "pata", "patas",
  "corazon", "higado", "rinon", "lengua", "ventresca",
  "cabeza", "filete", "filetes",
  // Estado físico/corte
  "lonchas", "loncheado", "fileteado", "rallado", "troceado", "picado",
  "entero", "entera", "enteros", "enteras", "trozos", "trozo",
  "rodajas", "dado", "dados", "tiras",
  // Calidad/composición
  "magro", "magra", "semigrasa", "grasa", "graso", "integral",
  "blanco", "blanca", "blancos", "blancas", "rojo", "roja",
  "verde", "verdes", "negro", "negra",
  "natural", "naturales", "tradicional", "clasico", "original",
  "casero", "artesanal", "premium", "extra", "selecto", "gourmet", "especial",
  "ecologico", "ecologica", "bio", "organico",
  // Origen/marca de supermercados españoles
  "mercadona", "carrefour", "lidl", "dia", "eroski", "alcampo", "aldi",
  "consum", "hipercor", "hacendado", "origen", "espana",
  // Descriptores nutricionales
  "bajo", "alto", "libre", "reducido", "sal", "azucar",
  "desnatado", "desnatada", "semidesnatado", "semidesnatada", "light",
  "sodio", "calorias", "gluten", "lactosa", "vitamina",
  // Conservación
  "congelado", "congelada", "enlatado", "envasado", "pasteurizado",
  // Genéricos BEDCA
  "parte", "especificar", "tipo", "estilo", "sabor",
  "piel", "hueso", "espina", "semilla", "pepita",
]);

// Extrae los tokens-ingrediente: filtra stop words Y descriptores.
function ingredientTokens(name) {
  return tokenize(name).filter((t) => !NON_INGREDIENT_TOKENS.has(t));
}

function getFoodTier(candidate, originalFood) {
  // T3: platos preparados (flag-based — fiable)
  if ((candidate.flags || []).includes("prepared")) return 3;

  // T1: comparten al menos un ingrediente real.
  //
  // Estrategia: filtramos descriptores (crudo, fresco, plancha, marcas,
  // piezas como "pechuga"/"lomo") y comparamos los tokens-ingrediente.
  //
  // Ejemplos:
  //   "Pechuga de pollo Mercadona" → {pollo}
  //   "Pollo, muslo, crudo"        → {pollo}
  //   → Intersección = {pollo} → T1 ✓
  //
  //   "Pollo, pechuga"  → {pollo}
  //   "Pavo, pechuga"   → {pavo}
  //   → Intersección = {} → T2 ✓ (mismo corte pero distinto animal)
  const origIng = new Set(ingredientTokens(originalFood.name));
  const candIng = new Set(ingredientTokens(candidate.name));

  if (origIng.size > 0 && candIng.size > 0) {
    for (const t of origIng) {
      if (candIng.has(t)) return 1;
    }
    return 2;
  }

  // Fallback: si alguno de los nombres no tiene ingrediente claro
  // (ej: "Lomo Mercadona" sin mencionar el animal), volvemos al
  // método del primer token — más permisivo para nombres ambiguos.
  const baseTokens = tokenize(originalFood.name);
  const baseWord = baseTokens[0] || "";
  if (baseWord && norm(candidate.name).includes(baseWord)) return 1;

  return 2;
}

// ============================================
// EQUIVALENCE CALCULATION
// ============================================
function calculateEquivalence(
  alt,
  original,
  originalAmount,
  originalMacros,
) {
  const anchor = getAnchorMacro(original);

  // Si el alimento "original" no tiene el macro ancla, no se puede calcular bien
  if (!original[anchor] || original[anchor] <= 0) return null;
  if (!alt[anchor] || alt[anchor] <= 0) return null;

  const ratio = original[anchor] / alt[anchor];
  const equivalentAmount = Math.round(originalAmount * ratio);

  if (equivalentAmount < 5) return null; // evita 0g / 1g raros
  if (equivalentAmount > 600) return null; // evita monstruos

  const altMacros = {
    protein: (alt.protein * equivalentAmount) / 100,
    carbs: (alt.carbs * equivalentAmount) / 100,
    fat: (alt.fat * equivalentAmount) / 100,
    calories: (alt.calories * equivalentAmount) / 100,
  };

  const proteinDiff = altMacros.protein - originalMacros.protein;
  const carbsDiff = altMacros.carbs - originalMacros.carbs;
  const fatDiff = altMacros.fat - originalMacros.fat;
  const caloriesDiff = altMacros.calories - originalMacros.calories;

  // Penalización: prioriza el macro "ancla"
  let penalty = 0;

  if (anchor === "protein") {
    penalty += Math.abs(proteinDiff) * 3;
    penalty += Math.abs(carbsDiff) * 1.5;
    penalty += fatDiff > 0 ? fatDiff * 2.5 : Math.abs(fatDiff) * 0.8;
  } else if (anchor === "carbs") {
    penalty += Math.abs(carbsDiff) * 3;
    penalty += Math.abs(proteinDiff) * 1.5;
    penalty += Math.abs(fatDiff) * 1.2;
  } else if (anchor === "fat") {
    penalty += Math.abs(fatDiff) * 3;
    penalty += Math.abs(carbsDiff) * 1.2;
    penalty += Math.abs(proteinDiff) * 1.2;
  } else {
    // calories
    penalty += Math.abs(caloriesDiff) * 0.6;
    penalty += Math.abs(proteinDiff) * 1.2;
    penalty += Math.abs(carbsDiff) * 1.2;
    penalty += Math.abs(fatDiff) * 1.2;
  }

  const totalMacros =
    originalMacros.protein + originalMacros.carbs + originalMacros.fat;
  const matchScore = Math.max(
    0,
    Math.round(100 - (penalty / Math.max(totalMacros, 10)) * 100),
  );

  let level = null;
  if (matchScore >= 95 && equivalentAmount <= 300) level = "perfect";
  else if (matchScore >= 75 && equivalentAmount <= 400) level = "good";
  else if (matchScore >= 60) level = "advanced";
  else return null;

  return {
    ...alt,
    equivalentAmount,
    macros: altMacros,
    matchScore,
    level,
    diffs: {
      protein: proteinDiff,
      carbs: carbsDiff,
      fat: fatDiff,
      calories: caloriesDiff,
    },
  };
}

// ============================================
// SEMANTIC RERANK (calls microservice, falls back on error)
// ============================================
async function rerankCandidates(query, taggedCandidates) {
  // taggedCandidates: array of objects with {id, tier, ...other fields}
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);
  try {
    const payload = {
      query,
      candidates: taggedCandidates.slice(0, MAX_CANDIDATES).map(c => ({
        id: c.id,
        tier: c.tier,
      })),
    };
    const resp = await fetch(`${API_URL}/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.ranked; // [{id, score, tier}, ...]
  } catch {
    return null; // timeout, network error, parse error → fallback
  } finally {
    clearTimeout(timer);
  }
}

// ============================================
// CROSS-CATEGORY COMPATIBILITY
// ============================================
// Algunos alimentos en categorías distintas son clínicamente intercambiables.
// Ejemplo: Skyr (postres_proteicos) y Yopro (dairy/high_protein_dairy) son
// nutricionalmente equivalentes — la clienta debería poder cambiar uno por otro.
//
// Esta función decide si un candidato es compatible con el original incluso
// si están en categorías diferentes. Solo permite cross-category bajo
// condiciones estrictas para evitar mezclar quesos curados o pescados.
const PROTEIC_DAIRY_SUBGROUPS = new Set([
  "high_protein_dairy",  // Skyr, Yopro, yogur proteico
  "basic_dairy",         // yogur natural, leche enriquecida
  "fruit",               // yogur proteico con fruta (subgroup raro pero real)
]);

function isProteicDairy(food) {
  return (
    food.category === "dairy" &&
    food.macro_profile === "protein" &&
    PROTEIC_DAIRY_SUBGROUPS.has(food.subgroup)
  );
}

function isCompatibleCategory(candidate, original) {
  // Caso normal: misma categoría
  if (candidate.category === original.category) return true;

  // Cross-category: postres_proteicos ↔ dairy proteico (yogures, skyr)
  if (original.category === "postres_proteicos" && isProteicDairy(candidate)) {
    return true;
  }
  if (isProteicDairy(original) && candidate.category === "postres_proteicos") {
    return true;
  }

  return false;
}

// ============================================
// ALTERNATIVES CALCULATION (with tier system)
// ============================================
async function calculateAlternatives(originalFood, amount) {
  const originalMacros = {
    protein: (originalFood.protein * amount) / 100,
    carbs: (originalFood.carbs * amount) / 100,
    fat: (originalFood.fat * amount) / 100,
    calories: (originalFood.calories * amount) / 100,
  };

  const candidates = foodsDatabase.filter(
    (f) =>
      f.id !== originalFood.id &&
      isCompatibleCategory(f, originalFood) &&
      !(f.flags || []).includes("condiment") &&
      !(f.flags || []).includes("sweet") &&
      !(f.flags || []).includes("hidden"),
  );

  const withEquivalence = candidates
    .map((alt) => {
      const tier = getFoodTier(alt, originalFood);
      const eq = calculateEquivalence(alt, originalFood, amount, originalMacros);
      if (!eq) return null;
      return { ...eq, tier };
    })
    .filter(Boolean);

  const t1 = withEquivalence.filter((a) => a.tier === 1);
  const t2 = withEquivalence.filter((a) => a.tier === 2);
  const t3 = withEquivalence.filter((a) => a.tier === 3);

  // Incluir siempre T3 — queremos mostrar la sección "preparados" separada.
  // La lógica anterior los excluía como "fallback" pero ahora tienen su propio slot.
  const all = [...t1, ...t2, ...t3];

  // Pre-sort by (tier ASC, matchScore DESC) so the microservice receives
  // the TOP 50 most relevant candidates — not the first 50 in DB insertion order
  const allByScore = [...all].sort(
    (a, b) => a.tier !== b.tier ? a.tier - b.tier : b.matchScore - a.matchScore,
  );

  // Attempt semantic rerank via microservice
  const ranked = await rerankCandidates(originalFood.name, allByScore);

  let sorted;
  if (ranked) {
    // Build id→object map (all items, not just top 50)
    const byId = Object.fromEntries(all.map(a => [a.id, a]));
    const seen = new Set();
    const reordered = [];

    // Attach semantic score to each ranked item, then compute hybrid score:
    //   hybrid = 0.65 * (matchScore/100) + 0.35 * semanticScore
    // This ensures a 100% mathematical match beats a 96% match even if the
    // semantic model slightly prefers the 96% one (scores are often within 0.05).
    for (const r of ranked) {
      const item = byId[r.id];
      if (item) {
        reordered.push({ ...item, _semanticScore: r.score });
        seen.add(r.id);
      }
    }

    // Sort by (tier ASC, hybridScore DESC) — tier system always wins
    reordered.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const hA = 0.65 * (a.matchScore / 100) + 0.35 * (a._semanticScore || 0);
      const hB = 0.65 * (b.matchScore / 100) + 0.35 * (b._semanticScore || 0);
      return hB - hA;
    });

    // Append leftovers (beyond MAX_CANDIDATES) sorted by tier+matchScore
    const leftovers = all.filter(a => !seen.has(a.id));
    leftovers.sort((a, b) => a.tier !== b.tier ? a.tier - b.tier : b.matchScore - a.matchScore);
    sorted = [...reordered, ...leftovers];
  } else {
    // Fallback: original tier+matchScore sort
    sorted = [...all].sort((a, b) => a.tier !== b.tier ? a.tier - b.tier : b.matchScore - a.matchScore);
  }

  // Attach _hybridScore to ALL items (leftovers have no semantic score → pure math)
  // Used for ordering within each group, not for grouping itself.
  const withHybrid = sorted.map(a => ({
    ...a,
    _hybridScore: 0.65 * (a.matchScore / 100) + 0.35 * (a._semanticScore || 0),
  }));

  // Group by semantic type using the existing tier field:
  //   T2 (different subgroup, same category) → real exchanges — show first, expanded
  //   T1 (same subgroup)                     → same ingredient family — collapsed
  //   T3 (prepared flag)                     → processed/prepared dishes — collapsed last
  //
  // Within each group, sort by hybrid score DESC so the best match is always first.
  const byTier = (t) =>
    withHybrid
      .filter(a => a.tier === t)
      .sort((a, b) => b._hybridScore - a._hybridScore);

  return {
    intercambios: byTier(2),
    familia:      byTier(1),
    preparados:   byTier(3),
  };
}

// ============================================
// TOKEN-AWARE SORT SCORE
// ============================================
function tokenSortScore(nameNorm, queryTokens) {
  let score = 0;
  const allPresent = queryTokens.every((t) => nameNorm.includes(t));
  if (allPresent) score += 5;
  queryTokens.forEach((t) => {
    if (nameNorm.includes(t)) score += 1;
    if (nameNorm.startsWith(t + " ") || nameNorm === t) score += 2;
  });
  if (queryTokens.some((t) => nameNorm.startsWith(t))) score += 3;
  return score;
}

// ============================================
// SOURCE BOOST — preferir BEDCA > OFF completo > Supermercados
// Solo se usa como desempate cuando dos alimentos tienen el mismo
// tokenSortScore. Nunca anula la relevancia textual.
// ============================================
function sourceBoost(food) {
  const src = (food.source || "").toLowerCase();
  if (src === "bedca") return 100;
  if (src === "openfoodfacts") {
    // Solo boost OFF si tiene los 4 macros completos (no null/undefined/0)
    const macrosOk =
      food.calories != null && food.calories > 0 &&
      food.protein != null &&
      food.carbs != null &&
      food.fat != null;
    return macrosOk ? 50 : 10;
  }
  // Supermercados (Mercadona, Carrefour, Lidl, Dia, Eroski, Alcampo, Aldi,
  // El Corte Inglés, Consum, Hipercor) y otros: sin boost
  return 0;
}

// ============================================
// SEARCH FOODS (local database)
// ============================================
async function searchFoods(query) {
  const qn = norm(query);

  // PASO 1: Buscar en database local
  // Excluimos "hidden" (duplicados nutricionales) para no inflar el listado
  // de búsqueda con 12 versiones del mismo arroz/atún/pollo.
  const localResults = foodsDatabase
    .filter((food) => matchesFood(food, query))
    .filter((food) => !(food.flags || []).includes("hidden"))
    .sort((a, b) => {
      const tokens = tokenize(query);
      const scoreA = tokenSortScore(norm(a.name || ""), tokens);
      const scoreB = tokenSortScore(norm(b.name || ""), tokens);
      if (scoreA !== scoreB) return scoreB - scoreA;
      // 1er desempate: prioridad de fuente — BEDCA primero, después OFF completo
      const boostA = sourceBoost(a);
      const boostB = sourceBoost(b);
      if (boostA !== boostB) return boostB - boostA;
      // 2do desempate: nombre más corto primero
      return (a.name || "").length - (b.name || "").length;
    });

  // PASO 2: Si tenemos ≥10 resultados locales, mostrar solo esos
  if (localResults.length >= 10) {
    lastSearchResults = localResults;
    lastQuery = query;
    renderAutocomplete(lastSearchResults, lastQuery, false);
    return;
  }

  // PASO 3: Si <10 resultados, buscar en FatSecret API
  console.log(
    `⚠️ Solo ${localResults.length} resultados locales. Consultando FatSecret...`,
  );

  try {
    const apiResults = await searchFatSecretAPI(query);

    // Combinar resultados: local primero, luego API
    lastSearchResults = localResults;
    lastQuery = query;
    renderAutocomplete(localResults, query, true, apiResults);
  } catch (error) {
    console.error("Error buscando en FatSecret:", error);
    // Si falla API, mostrar solo resultados locales
    lastSearchResults = localResults;
    lastQuery = query;
    renderAutocomplete(localResults, query, false);
  }
}
