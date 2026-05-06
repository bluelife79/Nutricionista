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

// URL del microservicio de re-ranking semántico.
// El microservicio se despliega aparte (Coolify/Railway/Render) — no en Vercel.
//
// Cómo configurarlo:
//   1. Por defecto usa localhost:8000 (desarrollo local con uvicorn).
//   2. En producción: setear `window.RERANK_API_URL` antes de cargar este script,
//      o agregarlo como meta tag en index.html:
//         <meta name="rerank-api-url" content="https://tu-microservicio.coolify.app">
//   3. Si el microservicio falla o tarda > 500ms → fallback automático
//      al matchScore matemático (sin rerank semántico).
const API_URL = (() => {
  // 1. Prioridad: variable global window
  if (typeof window !== "undefined" && window.RERANK_API_URL) {
    return window.RERANK_API_URL;
  }
  // 2. Meta tag en HTML
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="rerank-api-url"]');
    if (meta && meta.content) return meta.content;
  }
  // 3. Fallback dev local
  return "http://localhost:8000";
})();
const RERANK_TIMEOUT_MS = 500;
const MAX_CANDIDATES = 50;

// ── LLM Judge constants ───────────────────────────────────────────────────────
// JUDGE_TIMEOUT_MS must exceed server-side LLM_TIMEOUT_MS so the server gets
// to respond + cache before we abort. Server default 15000 → frontend 16000.
// JUDGE_TOP_N must be ≤ server-side LLM_MAX_CANDIDATES (default 30) — fewer
// candidates = lower input tokens = lower latency.
const JUDGE_TIMEOUT_MS    = 16000;
const JUDGE_TOP_N         = 30;
const JUDGE_DEMOTE_FACTOR = 0.05;  // removed_ids → ×0.05 on _sortScore (soft demote, never delete)

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
// LLM JUDGE — selective fallback (6 triggers in JS, microservice is dumb)
// ============================================
//
// Trigger evaluation, fetch wrapper, and verdict application.
// The judge runs on top-50 T2 candidates AFTER /rerank and BEFORE byTier().
// On any error (timeout, 5xx, network, parse) the judge is a no-op.
// Kill-switch: window.LLM_JUDGE_ENABLED = false → skips everything.
//
// Debug logging is gated on ?debug=1. ZERO lines appear in production.

// Returns array of trigger codes that fired (e.g. ["S2","S4"]). Empty → skip.
// Pure function — no side effects, no logging (caller handles debug output).
function evaluateJudgeTriggers(originalFood, topCandidates) {
  const fired = new Set();
  const s1Max  = Number(window.LLM_JUDGE_TRIGGER_S1_CONFIDENCE_MAX) || 70;
  const s5Rat  = Number(window.LLM_JUDGE_TRIGGER_S5_CALORIE_RATIO)  || 1.0;
  const s6Rat  = Number(window.LLM_JUDGE_TRIGGER_S6_SCORE_RATIO)    || 0.3;

  for (const c of topCandidates) {
    // S1: bulk-label confidence below threshold
    if (c.label_confidence != null && c.label_confidence < s1Max) fired.add('S1');
    // S2: raw_ingredient asymmetry (origin not raw, candidate raw)
    if (c.raw_ingredient === true && originalFood.raw_ingredient !== true) fired.add('S2');
    // S3: candidate has no bulk-label flags (food added post-bulk-label run)
    if (c.ready_to_eat === undefined) fired.add('S3');
    // S4: subgroup missing on either side
    if (c.subgroup == null || originalFood.subgroup == null) fired.add('S4');
    // S5: macro outlier (>N× calorie distance relative to origin)
    if (originalFood.calories > 0 && c.calories != null) {
      const delta = Math.abs(c.calories - originalFood.calories) / originalFood.calories;
      if (delta > s5Rat) fired.add('S5');
    }
    // S6: aggressive combined demotion (final score < ratio of base)
    if (c._sortScoreBase > 0 && (c._sortScore / c._sortScoreBase) < s6Rat) fired.add('S6');
  }
  return [...fired];
}

// Strip a food object down to only the fields the judge endpoint needs.
// Avoids shipping _sortScore, equivalentAmount, macros, diffs, etc.
function pickJudgeFields(f) {
  return {
    id:               f.id,
    name:             f.name,
    category:         f.category         ?? null,
    subgroup:         f.subgroup          ?? null,
    ready_to_eat:     f.ready_to_eat      ?? null,
    raw_ingredient:   f.raw_ingredient    ?? null,
    meal_slot:        f.meal_slot         ?? null,
    frequency:        f.frequency         ?? null,
    exotic:           f.exotic            ?? null,
    label_confidence: f.label_confidence  ?? null,
    calories:         f.calories          ?? null,
  };
}

// Single fetch to POST /judge with AbortController.
// Returns verdict object ({ranked_ids, removed_ids, ...}) on success, null on any failure.
// NEVER throws — all errors are caught and return null (graceful no-op).
async function callJudge(originalFood, topCandidates, triggered) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
  const _isDebug = window.location.search.includes('?debug=1');
  try {
    const payload = {
      origin:         pickJudgeFields(originalFood),
      candidates:     topCandidates.map(pickJudgeFields),
      debug_triggers: triggered,
    };
    if (_isDebug) {
      console.debug('[llm-judge] CALL origin=\'' + originalFood.name + '\' candidates=' + topCandidates.length + ' triggers=[' + triggered.join(',') + ']');
    }
    const resp = await fetch(`${API_URL}/judge`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  controller.signal,
    });
    if (!resp.ok) {
      if (_isDebug) console.debug('[llm-judge] ERROR HTTP ' + resp.status + ' — fallback=original-order');
      return null;
    }
    const verdict = await resp.json();

    // localStorage counter (REQ-H frontend self-monitoring)
    // Increments on every actual network call (not on skip, not on cache hits
    // that never reach this code path). Key format: llm_judge_calls_<YYYY-MM-DD>.
    try {
      const _today = new Date().toISOString().slice(0, 10);
      const _key   = 'llm_judge_calls_' + _today;
      const _prev  = parseInt(localStorage.getItem(_key) || '0', 10);
      localStorage.setItem(_key, String(_prev + 1));
    } catch (_e) { /* localStorage may be disabled — ignore silently */ }

    // Debug: log cache hit/miss from verdict
    if (_isDebug) {
      const _cache = verdict.cache || 'unknown';
      const _lat   = verdict.latency_ms != null ? verdict.latency_ms : '?';
      if (_cache === 'hit') {
        console.debug('[llm-judge] HIT latency_ms=' + _lat);
      } else {
        console.debug('[llm-judge] MISS latency_ms=' + _lat);
      }
    }
    return verdict;
  } catch (_err) {
    if (_isDebug) console.debug('[llm-judge] ERROR ' + _err.name + ' — fallback=original-order');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Mutates withHybrid array in-place: applies ranked_ids order and demotes removed_ids.
// ranked_ids → set _judgeRank field (used as primary sort key in byTier).
// removed_ids → _sortScore ×= JUDGE_DEMOTE_FACTOR (soft demote, never delete).
// Items not mentioned in ranked_ids get _judgeRank = 9999 (sort to tail).
function applyJudgeVerdict(withHybrid, verdict) {
  const removed = new Set(verdict.removed_ids || []);
  const order   = new Map((verdict.ranked_ids || []).map((id, i) => [id, i]));

  for (const item of withHybrid) {
    if (removed.has(item.id)) {
      item._sortScore *= JUDGE_DEMOTE_FACTOR;
    }
    item._judgeRank = order.has(item.id) ? order.get(item.id) : 9999;
  }
}

// ============================================
// SOURCE AFFINITY — preferir misma fuente en intercambios
// ============================================
//
// Las fuentes de la base de datos pertenecen a 2 familias:
//
//   GENÉRICOS  → BEDCA (base oficial española de composición de alimentos,
//                 alimentos sin marca, "marca blanca", naturales)
//
//   COMERCIALES → OpenFoodFacts + supermercados (Mercadona, Carrefour, Lidl,
//                 Dia, Eroski, Alcampo, Aldi, Consum, Hipercor, Hacendado,
//                 etc.) — productos con marca específica
//
// Cuando la clienta selecciona un alimento de una familia, los intercambios
// se ordenan PRIMERO con candidatos de la misma familia, y dentro de eso
// se prioriza la fuente exacta. La lógica es flexible: un cross-family con
// matchScore mucho mejor (>~30 puntos) puede ganarle a un same-family mediocre.
//
// Listas extensibles: agregar nuevas fuentes acá cuando aparezcan en el
// futuro. Cualquier fuente que no esté listada cae automáticamente en
// COMERCIALES por defecto (comportamiento conservador).

const GENERIC_SOURCES = new Set([
  "bedca",
  // Si en el futuro se agrega CESNID, USDA-equivalente español, etc., va acá
]);

const BRANDED_SOURCES = new Set([
  "openfoodfacts",
  "mercadona", "carrefour", "lidl", "dia", "eroski",
  "alcampo", "aldi", "consum", "hipercor", "hacendado",
  // Otros, otros marca → caen acá por default
]);

function sourceFamily(source) {
  const s = (source || "").toLowerCase();
  if (GENERIC_SOURCES.has(s)) return "generic";
  return "branded"; // default para todo lo no-genérico
}

// Bonus al sortScore según afinidad de fuente con el alimento original.
// Valores calibrados: misma fuente +0.30, misma familia +0.15, distinta +0.
//
// Esto hace que misma-familia gane cuando hay diferencia de matchScore
// menor a ~30 puntos, pero permite que un cross-family excelente le gane
// a un same-family mediocre.
function sourceAffinityBonus(candidate, original) {
  const cs = (candidate.source || "").toLowerCase();
  const os = (original.source || "").toLowerCase();

  // Misma fuente exacta — máxima afinidad
  if (cs && os && cs === os) return 0.30;

  // Misma familia (ej: Mercadona ↔ Carrefour, OFF ↔ Lidl)
  if (sourceFamily(cs) === sourceFamily(os)) return 0.15;

  // Cruza familias (BEDCA ↔ Mercadona, BEDCA ↔ OFF) — sin bonus
  return 0.00;
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
  // T4.6: Run the consistency check once per page load (lazy, idempotent).
  // This fires assertSubgroupConsistency the first time calculateAlternatives
  // is called so DB drift warnings appear in the console without blocking startup.
  if (typeof window.initExchangeGroupsOnce === "function") {
    window.initExchangeGroupsOnce(window.foodsDatabase);
  }

  // Bulk-label runtime config (read at call time so DevTools overrides apply
  // without page reload). Defaults match production.
  const _bulkLabelEnabled =
    window.BULK_LABEL_FILTERS_ENABLED !== false;          // default true
  const _demoteMealSlot =
    Number(window.BULK_LABEL_DEMOTION_MEAL_SLOT) || 0.6;
  const _demoteExotic =
    Number(window.BULK_LABEL_DEMOTION_EXOTIC)    || 0.7;
  const _demoteRare =
    Number(window.BULK_LABEL_DEMOTION_RARE)      || 0.5;
  // POST-PILOT: ready_to_eat mismatch downgraded from hard filter to soft
  // demotion. Pescado crudo es nutricionalmente equivalente a cocinado.
  const _demoteUncooked =
    Number(window.BULK_LABEL_DEMOTION_UNCOOKED)  || 0.85;

  const originalMacros = {
    protein: (originalFood.protein * amount) / 100,
    carbs: (originalFood.carbs * amount) / 100,
    fat: (originalFood.fat * amount) / 100,
    calories: (originalFood.calories * amount) / 100,
  };

  // T4.5: AND-compose isCompatibleSubgroup with the existing candidate filter.
  //
  // Subgroup gate rules:
  //   1. Only runs when both foods are in the SAME category. Cross-category
  //      exceptions (e.g. Skyr <-> Yopro via postres_proteicos <-> dairy) are
  //      handled exclusively by isCompatibleCategory above — their subgroup
  //      taxonomies don't share an axis and double-filtering would cause regressions.
  //   2. Kill-switch: window.DISABLE_SUBGROUP_FILTER = true bypasses the filter
  //      completely (checked per-call inside isCompatibleSubgroup — NOT at init time).
  //   3. typeof guard: if exchange_groups.js fails to load, the app degrades
  //      gracefully to category-only filtering (no ReferenceError).
  const _subgroupFilterAvailable = typeof window.isCompatibleSubgroup === "function";

  const candidates = foodsDatabase.filter(
    (f) => {
      if (f.id === originalFood.id) return false;
      if (!isCompatibleCategory(f, originalFood)) return false;
      if ((f.flags || []).includes("condiment")) return false;
      if ((f.flags || []).includes("sweet")) return false;
      if ((f.flags || []).includes("hidden")) return false;

      // Subgroup filter: only on same-category pairs.
      // Cross-category path (e.g. postres_proteicos <-> dairy/high_protein_dairy)
      // has already been approved by isCompatibleCategory — skip subgroup here.
      if (
        _subgroupFilterAvailable &&
        f.category === originalFood.category &&
        !window.isCompatibleSubgroup(f, originalFood)
      ) {
        return false;
      }

      // ── BULK-LABEL HARD FILTERS ─────────────────────────────────────────
      // Active only when both foods have been labeled (ready_to_eat is bool).
      // Foods without flags are no-ops: backward-compatible with un-labeled DB.
      // Kill-switch: window.BULK_LABEL_FILTERS_ENABLED === false bypasses both
      // hard filters and soft demotions (read once at function entry, §7.3).
      //
      // POST-PILOT REVISION (per design §13 D14 + decision #367 follow-up):
      // The original spec REQ-G defined a SECOND hard filter
      //   `original.ready_to_eat===true && candidate.ready_to_eat===false → exclude`
      // intended to block "Arroz cocido → Centeno crudo". In practice, this
      // over-filters legitimate substitutions where the candidate just needs
      // cooking (Salmón plancha → Merluza fresca is clinically valid). The
      // filter was downgraded to a SOFT demotion (see _demoteUncooked below).
      // Only `raw_ingredient===true` remains as a hard filter — that one is
      // unambiguous (harina/almidón/levadura are NEVER directly consumable).
      //
      // LLM-JUDGE-FALLBACK F0.1 (asymmetric raw_ingredient rule):
      // Upgraded from `origin.ready_to_eat===true && candidate.raw_ingredient===true`
      // to the asymmetric condition: candidate.raw_ingredient===true AND origin is
      // NOT also a raw_ingredient. This is stricter and handles the Papa cruda case:
      //   Patata cruda (raw_ingredient=false) → Harina de trigo (raw_ingredient=true) BLOCKED
      //   Harina de trigo (raw_ingredient=true) → Harina de centeno (raw_ingredient=true) ALLOWED
      // This rule is independent of ready_to_eat on the origin — solving the Papa→Harina
      // case deterministically, without needing the LLM judge (which would also block it
      // via trigger S2). This filter is a redundant safety net: even if /judge fails or
      // is disabled, raw cooking ingredients never surface as exchanges.
      if (_bulkLabelEnabled) {
        // Hard filter: raw_ingredient asymmetry.
        // Blocks candidate only when origin is NOT also a raw ingredient.
        // Uses strict equality (=== true) to avoid false positives on undefined/null.
        if (f.raw_ingredient === true && originalFood.raw_ingredient !== true) {
          if (window.location.search.includes('?debug=1')) {
            console.debug('[bulk-label] HARD_FILTER candidate=\'' + f.name + '\' (raw_ingredient asymmetric)');
          }
          return false;
        }
      }

      return true;
    },
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

  // Attach _hybridScore y _sortScore a TODOS los items.
  //
  //   _hybridScore = 0.65 × matemática + 0.35 × semántica (rango 0-1)
  //                  Usado en la UI para mostrar el % de match al usuario.
  //
  //   _sortScore   = _hybridScore + sourceAffinityBonus (rango 0-1.30)
  //                  Usado para ORDENAR dentro de cada tier. Hace que la
  //                  misma fuente/familia gane cuando el match es razonable,
  //                  pero permite cross-family si la diferencia de match es
  //                  grande (>~30 puntos).
  const withHybrid = sorted.map(a => {
    const hybrid = 0.65 * (a.matchScore / 100) + 0.35 * (a._semanticScore || 0);
    const affinityBonus = sourceAffinityBonus(a, originalFood);

    // Soft demotions from bulk-label flags. Multiplicative, applied on top of
    // the additive sourceAffinityBonus. No-op when flags absent (strict equality
    // means undefined !== true / undefined !== "raro" — graceful degradation).
    let demotion = 1;
    if (_bulkLabelEnabled) {
      // Meal slot mismatch (origin breakfast → candidate dinner) — demote.
      // "any" on either side is a wildcard that never demotes.
      if (
        originalFood.meal_slot && a.meal_slot &&
        originalFood.meal_slot !== "any" && a.meal_slot !== "any" &&
        originalFood.meal_slot !== a.meal_slot
      ) {
        demotion *= _demoteMealSlot;   // default 0.6
        if (window.location.search.includes('?debug=1')) {
          console.debug('[bulk-label] DEMOTED candidate=\'' + a.name + '\' factor=' + _demoteMealSlot + ' reason=meal_slot_mismatch');
        }
      }
      // Candidate exotic but origin is not (Pollo → Cangrejo).
      if (a.exotic === true && originalFood.exotic !== true) {
        demotion *= _demoteExotic;     // default 0.7
        if (window.location.search.includes('?debug=1')) {
          console.debug('[bulk-label] DEMOTED candidate=\'' + a.name + '\' factor=' + _demoteExotic + ' reason=exotic');
        }
      }
      // Candidate rarely consumed in standard Spanish diet.
      if (a.frequency === "raro") {
        demotion *= _demoteRare;       // default 0.5
        if (window.location.search.includes('?debug=1')) {
          console.debug('[bulk-label] DEMOTED candidate=\'' + a.name + '\' factor=' + _demoteRare + ' reason=frequency_raro');
        }
      }
      // POST-PILOT: origin ready_to_eat but candidate needs cooking. Light
      // demotion — does NOT exclude (was a hard filter pre-pilot review).
      // Eg: Salmón plancha (origin) vs Merluza fresca (candidate, needs cooking).
      if (originalFood.ready_to_eat === true && a.ready_to_eat === false && a.raw_ingredient !== true) {
        demotion *= _demoteUncooked;   // default 0.85
        if (window.location.search.includes('?debug=1')) {
          console.debug('[bulk-label] DEMOTED candidate=\'' + a.name + '\' factor=' + _demoteUncooked + ' reason=needs_cooking');
        }
      }
    }

    return {
      ...a,
      _hybridScore: hybrid,
      _sortScoreBase: hybrid + affinityBonus,
      _sortScore: (hybrid + affinityBonus) * demotion,
    };
  });

  // ── LLM JUDGE GATE ───────────────────────────────────────────────────────────
  // Selective LLM fallback — evaluates 6 triggers (S1-S6) on top-50 T2 candidates
  // AFTER /rerank and BEFORE byTier. If at least one trigger fires, issues ONE call
  // to POST /judge. Kill-switch: window.LLM_JUDGE_ENABLED = false → skip entirely.
  // On any error (timeout, 5xx, abort, parse) → no-op, original order preserved.
  //
  // Per REQ-A spec: only T2 candidates are judged (T1 = same ingredient family,
  // T3 = prepared dishes — both are high-confidence enough to skip LLM cost).
  {
    const _llmJudgeEnabled = window.LLM_JUDGE_ENABLED !== false;
    const _isDebug         = window.location.search.includes('?debug=1');

    if (!_llmJudgeEnabled) {
      if (_isDebug) console.debug('[llm-judge] SKIP enabled=false');
    } else {
      // Top-N T2 candidates sorted by descending _sortScore
      const _topT2 = withHybrid
        .filter(a => a.tier === 2)
        .sort((a, b) => b._sortScore - a._sortScore)
        .slice(0, JUDGE_TOP_N);

      if (_topT2.length === 0) {
        if (_isDebug) console.debug('[llm-judge] SKIP no T2 candidates');
      } else {
        const _triggered = evaluateJudgeTriggers(originalFood, _topT2);

        if (_triggered.length === 0) {
          if (_isDebug) console.debug('[llm-judge] SKIP triggers_fired=0 top_t2=' + _topT2.length);
        } else {
          if (_isDebug) {
            for (const _code of _triggered) {
              console.debug('[llm-judge] TRIGGERED reason=' + _code);
            }
          }
          const _verdict = await callJudge(originalFood, _topT2, _triggered);
          if (_verdict) {
            applyJudgeVerdict(withHybrid, _verdict);
            if (_isDebug) {
              console.debug(
                '[llm-judge] APPLIED cache=' + _verdict.cache +
                ' latency_ms=' + _verdict.latency_ms +
                ' ranked=' + (_verdict.ranked_ids || []).length +
                ' removed=' + (_verdict.removed_ids || []).length
              );
            }
          } else {
            if (_isDebug) console.debug('[llm-judge] ERROR fallback=original-order');
          }
        }
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // Group by semantic type using the existing tier field:
  //   T2 (different subgroup, same category) → real exchanges — show first, expanded
  //   T1 (same subgroup)                     → same ingredient family — collapsed
  //   T3 (prepared flag)                     → processed/prepared dishes — collapsed last
  //
  // Within each group, sort by _judgeRank (primary, when judge ran) then by
  // _sortScore DESC (secondary / fallback for items outside judge top-50 or
  // when the judge gate was skipped — _judgeRank ?? 9999 guarantees correct
  // behavior on the SKIP path without any special-casing).
  const byTier = (t) =>
    withHybrid
      .filter(a => a.tier === t)
      .sort((a, b) => {
        const ra = a._judgeRank ?? 9999;
        const rb = b._judgeRank ?? 9999;
        if (ra !== rb) return ra - rb;
        return b._sortScore - a._sortScore;
      });

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

  // Mostrar resultados locales (única fuente — FatSecret eliminado).
  lastSearchResults = localResults;
  lastQuery = query;
  renderAutocomplete(lastSearchResults, lastQuery);
}
