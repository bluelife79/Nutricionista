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
// JUDGE_TOP_N debe ser ≤ LLM_MAX_CANDIDATES del backend (Railway: 30).
// Si quieres más, subí LLM_MAX_CANDIDATES en Railway env vars primero.
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
  // Estados de cocción y preparación
  "crudo", "cruda", "crudos", "crudas",
  "cocido", "cocida", "cocidos", "cocidas",
  "fresco", "fresca", "frescos", "frescas",
  "seco", "seca", "secos", "secas",
  "asado", "asada", "asados", "asadas",
  "plancha", "vapor",
  "hervido", "hervida", "hervidos", "hervidas",
  "frito", "frita", "fritos", "fritas",
  "horneado", "horneada", "horneados", "horneadas",
  "tostado", "tostada", "tostados", "tostadas",
  "guisado", "guisada", "guisados", "guisadas",
  "salteado", "salteada", "salteados", "salteadas",
  "braseado", "braseada", "estofado", "estofada",
  "rehogado", "rehogada", "deshidratado", "deshidratada",
  // Preservación / envasado (suma — congelado/envasado existen abajo)
  "bote", "lata", "conserva", "envase",
  "envasada", "remojo", "germinado", "germinada",
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
  "rodajas", "dado", "dados", "tiras", "copo", "copos",
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
  // Preparaciones que NO son ingrediente — colapsan con la base
  // (Puré de patatas → patata; Crema de calabaza → calabaza)
  "pure", "puree",  // 'puré' tras norm() pierde la tilde
  "crema", "salsa", "sopa", "caldo",
]);

// Singularize naive ES: si la palabra tiene >=4 chars y termina en 's',
// quita la 's'. Permite que "patata" y "patatas" colapsen como mismo
// ingrediente. Falsos positivos aceptables (la lista de NON_INGREDIENT
// ya cubre la mayoría de descriptores plurales explícitamente).
function _singularize(token) {
  if (token.length >= 4 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

// ============================================
// SYNONYM GROUPS — para clustering en dedup de diversidad
// ============================================
//
// Tokens distintos que clínicamente son la MISMA familia de alimento.
// Se usan SOLO para construir el cluster key del dedup, no afectan el
// matching o el filtro clínico.
//
// Ej: "Pasta alimenticia cruda" BEDCA + "Macarrones Boloñesa" + "Italpasta
// almejas" + "Penne integral" → todos colapsan en cluster "pasta" del
// source family correspondiente. Resultado: 1 representante por source
// family (BEDCA + branded), no 5 variantes de pasta seguidas.
//
// Conservador: solo pasta-family por ahora (el caso reportado por Hugo).
// Agregar más groups si aparecen casos similares (carnes NO — pollo y
// ternera son clínicamente distintos; frutas NO — manzana y pera son
// intercambios legítimamente separados).
// Incluye formas naive-singularizadas (post _singularize): "macarrones"
// → "macarrone" tras strip 's', etc. Por eso aparecen ambas variantes.
const _PASTA_FAMILY = new Set([
  "pasta", "pastas",
  "macarron", "macarrones", "macarrone", "macaroni",
  "fideo", "fideos",
  "espagueti", "espaguetis", "spaghetti",
  "tallarin", "tallarines", "tallarine", "tagliatelle",
  "penne", "rigatoni", "fusilli", "farfalle", "fettuccine", "linguine",
  "ravioli", "raviolis",
  "tortellini", "tortelloni",
  "cannelon", "cannelones", "cannelone", "cannelloni",
  "lasana", "lasanas", "lasagna", "lasagnas",
  "noqui", "noquis", "gnocchi",
  "espiral", "espirales", "espirale",
  "italpasta",
  "lazo", "lazos",
  "pluma", "plumas",
  "codito", "coditos",
  "cinta", "cintas",
]);

// Devuelve la clave de cluster para un food. Estrategia:
//   1. Synonym groups (pasta family) → todos colapsan al canon del grupo.
//   2. Default: PRIMER token-ingrediente como raíz del cluster.
//      Los nombres en español típicamente empiezan por el sustantivo:
//      "Patata, asada" → patata; "Pollo, pechuga" → pollo; "Aceite de
//      oliva" → aceite; "Pasta alimenticia, cruda" → pasta.
//      Esto colapsa todas las variantes "Patata X" / "Patatas Y" en
//      un solo cluster, evitando que los descriptores ad-hoc del
//      nombre (corte, bravas, tortilla, grueso) sean parte de la clave.
//
// Costo: dedup más agresivo. Ej. "Aceite de oliva" y "Aceite de
// girasol" colapsan en aceite::generic — clínicamente intercambiables
// (mismo grupo de grasas), aceptable para diversidad. Si Hugo pide
// más granularidad en algún caso particular, agregamos un synonym
// group específico que separe.
function clusterIngredientKey(food) {
  const tokens = ingredientTokens(food.name);
  if (tokens.length === 0) return "__no_ingredient_" + food.id;
  for (const t of tokens) {
    if (_PASTA_FAMILY.has(t)) return "pasta::" + sourceFamily(food.source);
  }
  return tokens[0] + "::" + sourceFamily(food.source);
}

// Extrae los tokens-ingrediente: singulariza primero (para que plurales
// como "cocidas"/"patatas" se normalicen), luego filtra stop words,
// descriptores y numerales. El orden importa: singularizar después de
// filtrar deja pasar plurales no listados en NON_INGREDIENT_TOKENS.
function ingredientTokens(name) {
  return tokenize(name)
    .map(_singularize)
    .filter((t) => !NON_INGREDIENT_TOKENS.has(t) && !/^\d/.test(t));
}

// ============================================
// COOKING STATE — clinical raw/cooked symmetry
// ============================================
//
// Detecta el estado de cocción del nombre normalizado. Los intercambios
// nutricionales se calculan por 100g del alimento en el estado en que se
// pesa: arroz crudo (358 kcal) NO es equivalente a arroz cocido (130 kcal).
// Cuando el origen está en un estado y el candidato en el opuesto, se
// aplica una demotion fuerte (no se elimina — el clínico puede verlo).
//
// Returns: 'raw' | 'cooked' | 'neutral'
//   - 'neutral' cuando no hay marcador explícito en el nombre. NO penaliza
//     ni a uno ni a otro lado (la mayoría de foods no especifican estado).
const _RAW_TOKENS = new Set([
  "crudo", "cruda", "crudos", "crudas",
  "seco", "seca", "secos", "secas",
  "deshidratado", "deshidratada", "deshidratados", "deshidratadas",
]);
const _COOKED_TOKENS = new Set([
  "cocido", "cocida", "cocidos", "cocidas",
  "asado", "asada", "asados", "asadas",
  "hervido", "hervida", "hervidos", "hervidas",
  "plancha",
  "frito", "frita", "fritos", "fritas",
  "tostado", "tostada", "tostados", "tostadas",
  "horneado", "horneada", "horneados", "horneadas",
  "guisado", "guisada", "guisados", "guisadas",
  "salteado", "salteada", "salteados", "salteadas",
  "braseado", "braseada", "estofado", "estofada",
  "rehogado", "rehogada",
  "vapor",
]);

function getCookingState(name) {
  const tokens = tokenize(name);
  let raw = false;
  let cooked = false;
  for (const t of tokens) {
    if (_RAW_TOKENS.has(t)) raw = true;
    if (_COOKED_TOKENS.has(t)) cooked = true;
  }
  // Si el nombre tiene ambos (raro: "lentejas crudas, peso cocido"), priorizar cooked.
  if (cooked) return "cooked";
  if (raw) return "raw";
  return "neutral";
}

// ============================================
// COOKING INPUT — harinas, sémolas, almidones, copos deshidratados
// ============================================
//
// Detecta foods que son INSUMOS de cocina (no meal-equivalents). Una persona
// no come 120g de "harina de trigo" como reemplazo de 100g de arroz — la
// harina se transforma en pan/pasta/salsas. Mismo caso: sémola, almidón,
// fécula, fariña, "puré en copos" (deshidratado, se reconstituye).
//
// raw_ingredient=true del bulk-label captura esto en general PERO también
// captura granos crudos meal-equivalent (arroz crudo, quinoa cruda, pasta
// cruda) que SÍ son intercambios válidos. Por eso necesitamos detección
// más fina por nombre: solo los cooking inputs verdaderos.
const _COOKING_INPUT_TOKENS = new Set([
  "harina", "harinas",
  "semola", "semolas",
  "almidon", "almidones",
  "fecula", "feculas",
  "farina", "farinas",   // gallego/portugués
  "maicena",
]);
// Compound: "en copos" (ej. "Puré de patata, en copos", "Cereales en copos").
// Detectado sobre el string normalizado completo (tokenize filtra "en"
// como stop word, por eso vamos directo a norm()).
function isCookingInput(name) {
  const tokens = tokenize(name);
  for (const t of tokens) {
    if (_COOKING_INPUT_TOKENS.has(t)) return true;
  }
  // "en copos" — concentrado deshidratado (puré, patata, etc). No matchea
  // "copos de avena/espelta/cereales" solos (esos son granos para porridge).
  const normalized = norm(name);
  const isSimpleCerealFlake =
    /\b(avena|trigo|espelta|cebada|centeno|arroz|maiz|cereal)\b/.test(normalized);
  if ((normalized.includes(" en copos") || normalized.endsWith(" en copos")) &&
      !isSimpleCerealFlake) return true;
  return false;
}

// ============================================
// NON-STAPLE GRAINS — granos crudos no-plato en España
// ============================================
//
// Granos que existen en la BD pero NO son intercambio clínico válido para
// arroz/pasta/quinoa porque, aunque los hiervas, no se consumen como plato
// principal en España. Casos:
//   - Cebada cruda → se usa para gachas, sopas, cerveza. No "plato cebada".
//   - Centeno crudo → se usa para hacer pan. No se come hervido como arroz.
//   - Trigo entero crudo → bulgur sí se consume, pero "trigo entero" no.
//   - Espelta entera cruda → similar a trigo entero.
//   - Alpiste, sorgo, amaranto, teff, kamut, kasha → raros en España.
//
// NO matchea: bulgur, cuscús, quinoa, pasta, cereales desayuno, copos
// (avena, trigo), tortillas de trigo, harinas (otro filtro), pan de
// centeno, hogaza, cebada perlada (que va en sopas).
const _NON_STAPLE_GRAIN_PHRASES = [
  "centeno crudo", "centeno, crudo", "centeno entero",
  "cebada cruda", "cebada, cruda", "cebada en grano",
  "trigo entero", "trigo, entero",
  "espelta entera", "espelta, entera",
];
const _NON_STAPLE_GRAIN_TOKENS = new Set([
  "alpiste", "sorgo", "amaranto", "kasha", "teff", "kamut",
]);

function isNonStapleGrain(name) {
  const normalized = norm(name);
  for (const phrase of _NON_STAPLE_GRAIN_PHRASES) {
    if (normalized.includes(norm(phrase))) return true;
  }
  const tokens = tokenize(name);
  for (const t of tokens) {
    if (_NON_STAPLE_GRAIN_TOKENS.has(t)) return true;
  }
  return false;
}

// ============================================
// CULINARY PRESENTATION — ingrediente simple vs receta / líquido
// ============================================
//
// Los macros por sí solos no distinguen una verdura simple de una receta
// compuesta. Estas señales conservadoras evitan que "brócoli" abra con una
// parrillada, que "patata" muestre arroz con verduras como intercambio real
// o que una zanahoria entera trate un néctar como el mismo formato.
function isCompositePreparedFood(food) {
  if (!food) return false;
  if ((food.flags || []).includes("prepared")) return true;
  const n = norm(food.name || "");
  return (
    /\b(parrillad\w*|menestra\w*|saltead\w*|mix de|mezcla de|trio de|a la riojana|a la jardinera|falafel\w*|hummus\w*|con verduras|con setas|mexican\w*|veloute\w*|lasan\w*|tortelloni\w*|paella\w*|risotto\w*)\b/.test(n) ||
    /\bpure\w* .*\b(nata|queso|leche)\b/.test(n)
  );
}

function culinaryPresentation(food) {
  if (!food) return "simple";
  const n = norm(food.name || "");
  if (isCompositePreparedFood(food)) return "composite";
  if (/\b(zumo|jugo|nectar|smoothie|batido|licuado)\b/.test(n)) return "liquid";
  if (/\b(compota|papilla|potito)\b/.test(n)) return "puree";
  return "simple";
}

function getFoodTier(candidate, originalFood) {
  // T3: platos preparados, tanto por flag como por señales culinarias
  // conservadoras. El flag sigue mandando; la inferencia cubre huecos de
  // etiquetado del catálogo.
  if (isCompositePreparedFood(candidate)) return 3;

  // Fruta/verdura entera y su zumo, néctar, puré o papilla no son el mismo
  // formato culinario. Se conservan como referencia secundaria.
  if (
    originalFood &&
    candidate.category === originalFood.category &&
    ["fruits", "vegetables"].includes(originalFood.category) &&
    culinaryPresentation(candidate) !== culinaryPresentation(originalFood) &&
    culinaryPresentation(candidate) !== "simple"
  ) {
    return 3;
  }

  // En hidratos sensibles al formato, compartir una palabra del ingrediente
  // no basta para ser "misma familia": pan de avena no es otro formato de
  // copos de avena. Se mantiene como intercambio cross-forma.
  const originalShape = carbShape(originalFood);
  const candidateShape = carbShape(candidate);
  if (
    (originalShape === "flakes" || originalShape === "bread") &&
    candidateShape &&
    candidateShape !== originalShape
  ) {
    return 2;
  }

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

  // Hugo audit (Feedback Elena) Bloque 1 — cluster vegetal (plant_protein +
  // legumes). Cross-category (protein↔carbs). Se usa abajo en dos sitios:
  // (1) excepción al techo calórico, (2) fallback de nivel cuando no hay
  // equivalencia macro exacta (legumbre tiene carbs que tofu no, pero como
  // FUENTE PROTEICA VEGETAL es un intercambio real). Hugo: "referencias
  // vegetales útiles antes que dejarlo vacío".
  const _PLANT_CLUSTER_SUBS = new Set(["plant_protein", "legumes"]);
  const isSamePlantCluster =
    _PLANT_CLUSTER_SUBS.has(original.subgroup) &&
    _PLANT_CLUSTER_SUBS.has(alt.subgroup);

  const ratio = original[anchor] / alt[anchor];
  const equivalentAmount = Math.round(originalAmount * ratio);

  if (equivalentAmount < 5) return null; // evita 0g / 1g raros
  if (equivalentAmount > 600) return null; // evita monstruos

  const premiumPortion =
    typeof window.getPremiumPortionDecision === "function" &&
    window.PREMIUM_PORTION_FILTER_ENABLED !== false
      ? window.getPremiumPortionDecision(
          original,
          alt,
          originalAmount,
          equivalentAmount,
        )
      : {
          status: "direct",
          reason: "premium_portion_filter_disabled",
          multiplier: equivalentAmount / originalAmount,
        };
  if (premiumPortion.status === "reject") return null;

  // Hugo PDF Regla 7 HARD FILTER (mail 16/05 + informe operativo):
  // ratio cantidad_sugerida / cantidad_original > 3 → excluir del pool.
  // Excepción legítima ÚNICA: hidratos SECOS (raw_ingredient=true) →
  // cocidos (raw_ingredient=false) en mismo subgroup carbs (arroz crudo
  // 60g → patata cocida 250g es Russolillo válido). NO aplica para
  // legumbres, lácteos, grasas, proteínas, aceites o quesos.
  const qtyRatio = equivalentAmount / originalAmount;
  if (qtyRatio > 3) {
    const _HYDRATE_SUBS = new Set(["grains", "tubers"]);  // no legumes
    const isDrySrcWetCand =
      original.category === "carbs" && alt.category === "carbs" &&
      _HYDRATE_SUBS.has(original.subgroup) && _HYDRATE_SUBS.has(alt.subgroup) &&
      original.raw_ingredient === true && alt.raw_ingredient !== true;
    if (!isDrySrcWetCand) return null; // hard filter — fuera del pool
  }

  // Hugo PDF Regla 1 HARD FILTER — TECHO CALÓRICO:
  // Si kcal_alt > kcal_original * 1.40 → exclude_from_recommended_top.
  //
  // Excepciones:
  //   - Lean protein cluster (pollo 170 → ternera 250 = ratio 1.47 OK).
  //   - Fat cluster real (aguacate 137 → nueces 660 = ratio 4.8 OK,
  //     porque la porción equivalente se ajusta: 80g aguacate → 17g
  //     nueces. Las densidades dispares son normales en grasas).
  if (original.calories > 0 && alt.calories > 0) {
    const kcalRatio = alt.calories / original.calories;
    if (kcalRatio > 1.40) {
      const _LEAN_PROTEIN_SUBS = new Set([
        "meat_lean", "meat", "meat_fatty", "fish_white", "fish_fatty", "eggs",
      ]);
      const isSameLeanCluster =
        original.category === "protein" && alt.category === "protein" &&
        _LEAN_PROTEIN_SUBS.has(original.subgroup) &&
        _LEAN_PROTEIN_SUBS.has(alt.subgroup) &&
        alt.exotic !== true && original.exotic !== true;
      const _FAT_CLUSTER_SUBS = new Set([
        "olive_oil", "other_oils", "avocado", "nuts_seeds", "other_fat",
        "butter_margarine",
      ]);
      const isSameFatCluster =
        original.category === "fat" && alt.category === "fat" &&
        _FAT_CLUSTER_SUBS.has(original.subgroup) &&
        _FAT_CLUSTER_SUBS.has(alt.subgroup);
      // Hugo audit (Feedback Elena) caso patata — cluster de HIDRATOS base
      // exento del techo calórico, misma lógica que lean/fat/plant: la porción
      // equivalente se ajusta por gramaje (patata cruda 71 kcal → 19g de pasta
      // seca 367 kcal = mismo aporte). Sin esto, un hidrato de baja densidad
      // (patata/arroz hervido) NO podía ofrecer arroz/pasta/cuscús/quinoa secos
      // — Hugo: "debe quedarse en tubérculos e hidratos base: patata, boniato,
      // batata, arroz, pasta, cuscús, quinoa". El junk (galletas/bollería) ya
      // lo saca el gate clean_carb; el demote de densidad (kcal-ceiling ~2397)
      // mantiene el orden (misma densidad primero). Solo grains/tubers/legumes
      // (NO fruit/vegetables, que no son intercambio de gramaje). Reversible.
      const _carbClusterExempt =
        window.CARB_CLUSTER_KCAL_EXEMPT === undefined
          ? true
          : window.CARB_CLUSTER_KCAL_EXEMPT;
      const _CARB_CLUSTER_SUBS = new Set(["grains", "tubers", "legumes"]);
      const isSameCarbCluster =
        _carbClusterExempt &&
        original.category === "carbs" && alt.category === "carbs" &&
        _CARB_CLUSTER_SUBS.has(original.subgroup) &&
        _CARB_CLUSTER_SUBS.has(alt.subgroup);
      // Hugo audit (Feedback Elena) Bloque 1 — cluster vegetal exento del
      // techo calórico (isSamePlantCluster hoisteado arriba). La densidad
      // calórica varía mucho (tofu 73 kcal vs garbanzo cocido 139 o crudo
      // 330) pero la porción equivalente se ajusta por gramaje — igual que
      // el fat cluster. Sin esto tofu/seitán quedaban con 0 intercambios.
      if (!isSameLeanCluster && !isSameFatCluster && !isSamePlantCluster && !isSameCarbCluster) {
        return null; // hard filter
      }
    }
  }

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
  let matchScore = Math.max(
    0,
    Math.round(100 - (penalty / Math.max(totalMacros, 10)) * 100),
  );

  // En verduras simples de la misma familia botánica, las diferencias de
  // proteína/carbohidrato son pequeñas en términos absolutos pero el score
  // porcentual tradicional las exagera. La energía ya está igualada por el
  // gramaje equivalente; usamos además la cercanía de la porción para aceptar
  // intercambios culinarios obvios como brócoli ↔ coliflor.
  const isSameVegetableContext =
    original.category === "vegetables" &&
    alt.category === "vegetables" &&
    original.subgroup &&
    original.subgroup === alt.subgroup &&
    culinaryPresentation(original) === "simple" &&
    culinaryPresentation(alt) === "simple";
  if (isSameVegetableContext && matchScore < 60) {
    const safeRatio = Math.max(0.01, qtyRatio);
    const contextualScore = Math.max(
      60,
      Math.min(92, Math.round(100 - Math.abs(Math.log(safeRatio)) * 60)),
    );
    matchScore = contextualScore;
  }

  // DISPLAY-ONLY: % anclado a proteína para el fallback vegetal. El matchScore
  // macro castiga los carbs de la legumbre y cae a ~0%, pero como FUENTE
  // PROTEICA el intercambio es válido. Mostramos la cercanía de proteína (el
  // motivo real del swap) para no enseñar "0%" en un item recomendado, sin la
  // etiqueta confusa "Por familia". NO afecta el ORDEN: el sort usa matchScore,
  // no matchDisplay — solo cambia el número que ve la usuaria.
  let matchDisplay = matchScore;
  if (isSamePlantCluster && anchor === "protein" && matchScore < 55) {
    const _pClose =
      100 - Math.min(100, (Math.abs(proteinDiff) / Math.max(originalMacros.protein, 1)) * 100);
    // Cap 68: el fallback vegetal muestra un % creíble (55-68) pero SIEMPRE
    // por debajo de los matches reales del cluster (tempeh 70, seitán 77),
    // para que el orden visible siga siendo coherente con el %.
    matchDisplay = Math.max(55, Math.min(68, Math.round(_pClose * 0.68)));
  }

  let level = null;
  if (matchScore >= 95 && equivalentAmount <= 300) level = "perfect";
  else if (matchScore >= 75 && equivalentAmount <= 400) level = "good";
  else if (matchScore >= 60) level = "advanced";
  else if (
    // Hugo audit (Feedback Elena) Bloque 1 — FALLBACK VEGETAL.
    // Dentro del cluster vegetal el matchScore macro castiga los carbs de la
    // legumbre (tofu ~2g carbs vs garbanzo ~17g) y hunde el score, dejando
    // tofu/seitán sin intercambios. Pero como FUENTE PROTEICA VEGETAL la
    // legumbre SÍ es un intercambio real. Aceptamos como "advanced" cuando
    // la proteína está razonablemente cerca (±50% del ancla proteico) y la
    // porción es realista. Hugo: "referencias vegetales útiles, no vacío".
    isSamePlantCluster &&
    anchor === "protein" &&
    Math.abs(proteinDiff) <= originalMacros.protein * 0.5 &&
    equivalentAmount <= 400
  ) {
    level = "advanced";
  } else return null;

  return {
    ...alt,
    equivalentAmount,
    premiumPortionStatus: premiumPortion.status,
    premiumPortionReason: premiumPortion.reason,
    premiumPortionMultiplier: premiumPortion.multiplier,
    macros: altMacros,
    matchScore,
    matchDisplay,
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
// SEMANTIC RERANK — LOCAL EMBEDDINGS (client-side, zero infra)
// ============================================
//
// Carga embeddings.bin (int8 cuantizados, ~2 MB) una sola vez, cachea en
// memoria, y calcula cosine similarity entre origen y candidatos en el
// browser. Reemplaza el endpoint /rerank del microservicio (desactivado).
//
// Ventajas vs microservice:
//   - Zero latencia de red (cosine de 5K candidates en <5ms)
//   - Zero costo de infra recurrente
//   - Deploy estático Vercel
//   - Determinístico (no depende de uptime)
//
// Modelo: paraphrase-multilingual-MiniLM-L12-v2 (384-dim multilingual).
// Quantization: float32 [-1,1] → int8 [-127,127]. Error <0.002 por dim.
// Cosine = Σ(qa[i] × qb[i]) / (127 × 127), preserva ranking.

let _embeddingsCache = null;  // Promise<{ data, dim, index, divisor } | null>

function loadEmbeddings() {
  if (_embeddingsCache) return _embeddingsCache;
  if (typeof window === "undefined" || typeof fetch === "undefined") {
    return Promise.resolve(null);
  }
  if (window.SEMANTIC_EMBEDDINGS_ENABLED === false) {
    return Promise.resolve(null);
  }
  _embeddingsCache = Promise.all([
    fetch("assets/embeddings.bin").then(r => r.ok ? r.arrayBuffer() : null),
    fetch("assets/embeddings_meta.json").then(r => r.ok ? r.json() : null),
  ]).then(([bin, meta]) => {
    if (!bin || !meta) return null;
    const data = new Int8Array(bin);
    if (data.length !== meta.n * meta.dim) {
      console.warn("[embeddings] size mismatch — disabling");
      return null;
    }
    const index = new Map(Object.entries(meta.index));
    if (window.location.search.includes("?debug=1")) {
      console.debug("[embeddings] loaded n=" + meta.n + " dim=" + meta.dim + " size=" + (bin.byteLength/1024/1024).toFixed(2) + "MB");
    }
    return { data, dim: meta.dim, index, divisor: meta.cosine_divisor || (127 * 127) };
  }).catch(e => {
    console.warn("[embeddings] load failed:", e.message);
    return null;
  });
  return _embeddingsCache;
}

function _getEmbeddingRow(emb, id) {
  const i = emb.index.get(id);
  if (i === undefined) return null;
  return emb.data.subarray(i * emb.dim, (i + 1) * emb.dim);
}

function _cosineInt8(a, b, divisor) {
  let dot = 0;
  // Loop hint: fixed length, JIT unrolls. ~2µs per pair on M-series.
  const n = a.length;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot / divisor;
}

async function rerankCandidates(originalFood, taggedCandidates) {
  // Try LOCAL embeddings first (fast, no network).
  const emb = await loadEmbeddings();
  if (emb) {
    const originId = typeof originalFood === "string" ? null : originalFood.id;
    if (originId) {
      const oRow = _getEmbeddingRow(emb, originId);
      if (oRow) {
        const ranked = [];
        for (const c of taggedCandidates) {
          const cRow = _getEmbeddingRow(emb, c.id);
          // Foods nuevos sin embedding (BD changed post-quantize) → score neutro
          const score = cRow ? _cosineInt8(oRow, cRow, emb.divisor) : 0;
          ranked.push({ id: c.id, tier: c.tier, score });
        }
        ranked.sort((a, b) => b.score - a.score);
        return ranked;
      }
    }
  }
  // Fallback: network /rerank si está habilitado explícitamente
  if (typeof window !== "undefined" && window.RERANK_ENABLED !== true) {
    return null;
  }
  const query = typeof originalFood === "string" ? originalFood : originalFood.name;
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
    dairy_subfamily:  f.dairy_subfamily   ?? null,
    oil_added:        f.oil_added         ?? null,
    culinary_role:    f.culinary_role     ?? null,
    ready_to_eat:     f.ready_to_eat      ?? null,
    raw_ingredient:   f.raw_ingredient    ?? null,
    meal_slot:        f.meal_slot         ?? null,
    frequency:        f.frequency         ?? null,
    exotic:           f.exotic            ?? null,
    label_confidence: f.label_confidence  ?? null,
    calories:         f.calories          ?? null,
    // Macros per 100g (prompt v1.5+).
    protein:          f.protein           ?? null,
    fat:              f.fat               ?? null,
    carbs:            f.carbs             ?? null,
    // Pre-computed equivalence (prompt v2.0+) — el LLM compara directo
    // origen.macros_at_amount vs candidato.macros_at_eq sin recalcular.
    equivalent_amount: f.equivalentAmount ?? null,
    macros_at_eq:     f.macros            ?? null,
    usage_es:         f.usage_es          ?? null,
  };
}

// Single fetch to POST /judge with AbortController.
// Returns verdict object ({ranked_ids, removed_ids, ...}) on success, null on any failure.
// NEVER throws — all errors are caught and return null (graceful no-op).
async function callJudge(originalFood, topCandidates, triggered, amountSearched) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
  const _isDebug = window.location.search.includes('?debug=1');
  try {
    const payload = {
      origin:          pickJudgeFields(originalFood),
      candidates:      topCandidates.map(pickJudgeFields),
      debug_triggers:  triggered,
      // Gramos buscados por la usuaria (prompt v2.0+). Backend default=100
      // si ausente para mantener backward-compat.
      amount_searched: amountSearched ?? null,
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

// Hugo brief 16/05/2026 punto 4 — jerarquía 3 niveles:
//   generic       (BEDCA, legacy) — máxima afinidad
//   es_super      (supermercados/marcas ES conocidas) — afinidad media
//   international (OpenFoodFacts internacional) — afinidad mínima

const GENERIC_SOURCES = new Set([
  "bedca",
  "legacy",
  // Si en el futuro se agrega CESNID, USDA-equivalente español, etc., va acá
]);

// Supermercados ES + marcas españolas conocidas (Hugo punto 4):
// Mercadona, Lidl, Carrefour, Dia, Alcampo, Eroski, Consum + extensiones.
const ES_SUPER_SOURCES = new Set([
  "mercadona", "carrefour", "lidl", "dia", "eroski",
  "alcampo", "aldi", "consum", "hipercor", "hacendado",
  "el corte inglés", "el corte ingles",
  "bonpreu/esclat", "bonpreu", "esclat",
  "spar", "coviran", "covirán",
  "otros",  // entradas con marca española genérica
]);

function sourceMarketClass(foodOrSource) {
  const food =
    foodOrSource && typeof foodOrSource === "object" ? foodOrSource : null;
  const s = String(food ? food.source : foodOrSource || "").toLowerCase();
  if (GENERIC_SOURCES.has(s)) return "generic";
  if (["mercadona", "carrefour", "lidl", "aldi"].includes(s)) {
    return "core_es_super";
  }
  if (ES_SUPER_SOURCES.has(s)) return "other_es_super";
  if (s === "openfoodfacts") {
    const status = food?.market_provenance?.status;
    if (status === "verified_core_es") return "verified_core_off";
    if (status === "verified_spain_other") return "verified_es_off";
  }
  return "international";
}

function sourceFamily(foodOrSource) {
  const marketClass = sourceMarketClass(foodOrSource);
  if (marketClass === "generic") return "generic";
  if (
    marketClass === "core_es_super" ||
    marketClass === "other_es_super" ||
    marketClass === "verified_core_off"
  ) {
    return "es_super";
  }
  if (marketClass === "verified_es_off") return "verified_es";
  return "international";
}

// Bonus fijo pequeño de trazabilidad española. La relevancia nutricional y
// culinaria sigue mandando; este bonus únicamente resuelve resultados cercanos.
function sourceQualityBonus(food) {
  switch (sourceMarketClass(food)) {
    case "generic": return 0.08;
    case "core_es_super": return 0.06;
    case "other_es_super": return 0.04;
    case "verified_core_off": return 0.03;
    case "verified_es_off": return 0.01;
    default: return -0.20;
  }
}

// Bonus al sortScore según afinidad de fuente con el alimento original.
// Hugo brief punto 4 — jerarquía 3 niveles:
//   - Misma fuente exacta (Mercadona ↔ Mercadona)       → +0.45
//   - Misma familia (Mercadona ↔ Lidl, ambos es_super)  → +0.25
//   - Cross-family GENÉRICO→ES_SUPER (BEDCA → Mercadona)→ +0.10
//   - Cross-family GENÉRICO→INTERNACIONAL (BEDCA → OFF) → +0.00
//   - Cross-family ES_SUPER→INTERNACIONAL               → -0.05 (suave demote)
//
// Configurable via window.SOURCE_AFFINITY_EXACT, SOURCE_AFFINITY_FAMILY,
// SOURCE_AFFINITY_CROSS_GENERIC_ES, SOURCE_AFFINITY_INTERNATIONAL_PENALTY.
function sourceAffinityBonus(candidate, original) {
  const cs = (candidate.source || "").toLowerCase();
  const os = (original.source || "").toLowerCase();
  const exactBonus  = Number((typeof window !== "undefined" && window.SOURCE_AFFINITY_EXACT))  || 0.45;
  const familyBonus = Number((typeof window !== "undefined" && window.SOURCE_AFFINITY_FAMILY)) || 0.25;
  const genericEsBonus = Number((typeof window !== "undefined" && window.SOURCE_AFFINITY_CROSS_GENERIC_ES)) || 0.25;
  const intlPenalty = Number((typeof window !== "undefined" && window.SOURCE_AFFINITY_INTERNATIONAL_PENALTY)) || -0.20;

  // Misma fuente exacta — máxima afinidad. OpenFoodFacts es un agregador:
  // dos productos OFF no son "la misma tienda" por compartir ese rótulo.
  if (cs && os && cs === os && cs !== "openfoodfacts") return exactBonus;

  if (cs === "openfoodfacts" && os === "openfoodfacts") {
    const candidateRetailer = String(
      candidate.market_provenance?.retailer || "",
    ).toLowerCase();
    const originalRetailer = String(
      original.market_provenance?.retailer || "",
    ).toLowerCase();
    if (
      candidateRetailer &&
      originalRetailer &&
      candidateRetailer === originalRetailer
    ) {
      return exactBonus;
    }
    const candidateBrand = norm(candidate.brand || "");
    const originalBrand = norm(original.brand || "");
    if (candidateBrand && originalBrand && candidateBrand === originalBrand) {
      return Math.min(exactBonus, 0.30);
    }
  }

  const cFam = sourceFamily(candidate);
  const oFam = sourceFamily(original);

  // Misma familia (Mercadona ↔ Lidl, BEDCA ↔ legacy)
  if (cFam === oFam) {
    if (cFam === "verified_es") return Math.min(familyBonus, 0.08);
    if (cFam === "international") return intlPenalty;
    return familyBonus;
  }

  // Cross-family generic ↔ es_super (BEDCA → Mercadona vale más que → OFF)
  if ((oFam === "generic" && cFam === "es_super") ||
      (oFam === "es_super" && cFam === "generic")) {
    return genericEsBonus;
  }

  // OFF con evidencia española puede completar cobertura, pero nunca gana
  // por procedencia frente a BEDCA o un supermercado español directo.
  if (
    (cFam === "verified_es" && (oFam === "generic" || oFam === "es_super")) ||
    (oFam === "verified_es" && (cFam === "generic" || cFam === "es_super"))
  ) {
    return 0.03;
  }

  // Cross-family hacia INTERNATIONAL (Hugo: duplicados internacionales abajo)
  if (cFam === "international" && (oFam === "generic" || oFam === "es_super")) {
    return intlPenalty;
  }

  // Cualquier otro caso cross-family — sin bonus
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

  // Cross-category Hugo punto 2.E: plant_protein ↔ legumes.
  // Tofu/tempeh/seitán (category=protein, subgroup=plant_protein) cruzan
  // con lentejas/garbanzos/alubias (category=carbs, subgroup=legumes).
  // Son la primera línea de intercambio culinario para quien come tofu.
  if (
    (original.subgroup === "plant_protein" && candidate.subgroup === "legumes") ||
    (original.subgroup === "legumes" && candidate.subgroup === "plant_protein")
  ) {
    return true;
  }

  // Cross-category Hugo punto 2.E: plant_protein ↔ queso fresco/requesón.
  // Hugo: "queso fresco/requesón si encaja como opción no vegetal" para
  // sustituto de tofu. Permite category protein ↔ category dairy cuando
  // el dairy es fresco proteico (no curado/fundido).
  if (
    original.subgroup === "plant_protein" &&
    candidate.category === "dairy" &&
    (candidate.subgroup === "fresh_cheese" ||
     candidate.subgroup === "high_protein_dairy")
  ) {
    return true;
  }
  if (
    candidate.subgroup === "plant_protein" &&
    original.category === "dairy" &&
    (original.subgroup === "fresh_cheese" ||
     original.subgroup === "high_protein_dairy")
  ) {
    return true;
  }

  return false;
}

// ============================================
// PROCESSING LEVEL INFERENCE
// ============================================
// Infiere el nivel de procesado cuando el campo processing_level no está
// en la DB. Usa subgroup y tokens del nombre como señales.
// 0=simple/natural, 1=mínimamente procesado, 2=procesado, 3=ultraprocesado.
function inferProcessingLevel(food) {
  const sub  = (food.subgroup  || "").toLowerCase();
  const name = norm(food.name  || "");

  // Nivel 3 — ultraprocesado (fiambres elaborados, plant-protein industrial)
  if (sub === "processed_meat") return 3;
  if (name.includes("frankfurt") || name.includes("salchicha") ||
      name.includes("mortadela") || name.includes("chopped")) return 3;

  // Nivel 2 — procesado (marinados, ahumados, burger, queso fundido)
  if (name.includes("adobado") || name.includes("marinado") ||
      name.includes("ahumado") || name.includes("escabechado")) return 2;
  if (name.includes("burger")  || name.includes("hamburgue")) return 2;
  if (sub === "butter_margarine") return 2;
  // Aceites industriales poco habituales (palma, algodón, germen de trigo...)
  if (sub === "other_oils" &&
      (name.includes("palma") || name.includes("algodon") ||
       name.includes("germen") || name.includes("semilla") ||
       name.includes("higado"))) return 2;

  // Nivel 1 — mínimamente procesado (saborizados ligeros, preparados básicos)
  if (name.includes("sabor") || name.includes("saborizado") ||
      name.includes("con miel") || name.includes("azucarado")) return 1;
  if (name.includes("al garam") || name.includes("con especias") ||
      name.includes("con trufa")) return 1;
  if (name.includes("tostado") && sub === "legumes") return 1;

  return 0;
}

// ============================================
// CARB SHAPE — "forma" culinaria del hidrato (Hugo Feedback Elena)
// ============================================
// Hugo (ajuste fino avena/pan): "priorizar avena/cereal base"; "priorizar
// pan/tostada/wrap antes que otros hidratos". Dentro de carbs, agrupa por
// FORMA culinaria para que el intercambio respete el formato del plato:
//   bread (pan/tostada/wrap), flakes (avena/copos/cereal), pasta, grain
//   (arroz/quinoa/cuscús/maíz), tuber (patata/boniato). Misma forma se
//   premia; distinta se demota suave (sigue siendo intercambio válido — pan
//   ↔ patata cuadra nutricionalmente — pero no debe ir PRIMERO).
function carbShape(food) {
  if (!food || food.category !== "carbs") return null;
  // subgroup es dato curado y manda sobre el nombre: "Patata para tortilla"
  // es tuber aunque el nombre diga "tortilla". Evita falsos positivos del
  // regex de pan sobre productos de patata/batata.
  if (food.subgroup === "tubers") return "tuber";
  const n = norm(food.name || "");
  const label = norm(food.label_reason || "");
  // Algunas referencias comerciales omiten "pan" en el nombre, pero el
  // etiquetado curado sí confirma su formato. No usamos usage_es aquí porque
  // puede mencionar alimentos comparadores.
  if (/\bpan\b|\bpanecill\w*\b|\bhogaza\b|\bbiscot\w*\b/.test(label)) {
    return "bread";
  }
  // bread/tostada/wrap — Hugo audit (Feedback Elena, caso pan integral):
  // ampliado para cubrir nombres descriptivos que el regex viejo perdía y
  // que el motor clasificaba mal como flakes/grain (panecillo, hogaza,
  // rústica, tortilla de trigo/maíz=wrap, fajita). Va PRIMERO: un nombre con
  // keyword de pan gana sobre cereal/trigo/avena que aparezcan en el mismo
  // nombre (ej. "Hogaza de centeno y avena" → bread, no flakes).
  if (/\b(pan\w*|biscote\w*|wrap\w*|pita|rega[ñn]\w*|picos|colines|colin|bagel\w*|baguet\w*|chapat\w*|molde|mollete\w*|hogaza\w*|rustic\w*|tortilla\w*|fajita\w*|cracker\w*)\b/.test(n) ||
      /^tostad\w*\b/.test(n)) return "bread";
  if (/\b(avena|copos|cereal\w*|salvado|m[üu]esli|granola|porridge|gachas)\b/.test(n)) return "flakes";
  if (/\b(pasta|macarr\w*|espagueti\w*|espagueti|fideo\w*|tallarin\w*|noodle\w*|raviol\w*|penne|fusilli|rigaton\w*|lasa[ñn]\w*|[ñn]oqui\w*|gnocchi|canelon\w*|tortellini|maccaron\w*|spaguetti|spaghetti)\b/.test(n)) return "pasta";
  if (/\b(patata\w*|papa|papas|boniato\w*|batata\w*|yuca|mandioca|[ñn]ame)\b/.test(n)) return "tuber";
  if (/\b(arroz|quinoa|mijo|bulgur|cuscus|cusc[uú]s|s[eé]mola|trigo|cebada|centeno|espelta|sorgo|amaranto|kamut|farro|ma[ií]z|teff|alforf[oó]n|sarraceno)\b/.test(n)) return "grain";
  return null;
}

// Cereal de caja / instantáneo listo para desayuno. No confundir con copos
// simples, avena o salvado, que sí son ingredientes base.
function isIndustrialBreakfastCereal(food) {
  if (!food || food.category !== "carbs" || food.subgroup !== "grains") {
    return false;
  }
  if (carbShape(food) === "bread") return false;
  const n = norm(food.name || "");
  const context = norm(
    (food.name || "") + " " +
    (food.label_reason || ""),
  );
  const simpleFlake =
    /\b(avena( en)? copos|copos de avena|salvado de (avena|trigo)|porridge|gachas)\b/.test(n) &&
    food.ready_to_eat !== true;
  if (simpleFlake) return false;
  const cerealSignal =
    /\b(avena|cereal\w*|copos|bolas|flakes|fibre|hinchad\w*|inflad\w*|muesli|granola)\b/.test(n);
  const industrialSignal =
    /\b(cereales? de (caja|desayuno)|desayuno con leche|soluble\w*|infantil\w*|listo\w*|tostad\w*|azucarad\w*|choco\w*|frosties|special k|fitness|corn flakes|barras?|barritas?|galletas?|digestive)\b/.test(context);
  return cerealSignal &&
    food.raw_ingredient !== true &&
    (industrialSignal ||
      (food.ready_to_eat === true && food.meal_slot === "desayuno"));
}

function isDryLegume(food) {
  if (!food || food.subgroup !== "legumes") return false;
  const context = norm(
    (food.name || "") + " " +
    (food.label_reason || "") + " " +
    (food.usage_es || ""),
  );
  return food.raw_ingredient === true ||
    /\b(sec[oa]s?|crud[oa]s?|en grano|requiere remojo|precisa remojo|coccion prolongada|no comestible (crudo|directamente|sin coccion))\b/.test(context);
}

function proteinPreparationForm(food) {
  if (!food || food.category !== "protein") return null;
  const n = norm(food.name || "");
  const context = norm(
    (food.name || "") + " " +
    (food.label_reason || ""),
  );
  if (/\b(picad\w*|carne picada|minced|burgers?|hamburgues\w*)\b/.test(n)) return "minced";
  if (/\b(preparad\w*|fajita\w*|marinad\w*|adobad\w*|sazonad\w*|con salsa|rellen\w*|nugget\w*|rebozad\w*|empanad\w*|pincho\w*)\b/.test(context)) {
    return "prepared";
  }
  if (
    /\b(fiambre\w*|loncha\w*|lascas?|finissim\w*|brasead\w*|pechuga cocida|pollo cocido|pavo cocido)\b/.test(context) ||
    /\b(cocid\w*|asad\w*|al horno)\b/.test(n) ||
    (food.ready_to_eat === true &&
      /\b(pechuga|pollo|pavo|lomo|jamon|jamon)\b/.test(n))
  ) {
    return "deli";
  }
  if (/\b(lata|conserva|al natural|en aceite|escabeche)\b/.test(n)) {
    return "canned";
  }
  return "fresh";
}

function isPreparedFish(food) {
  if (!food || food.category !== "protein") return false;
  const n = norm(food.name || "");
  const context = norm(
    (food.name || "") + " " +
    (food.label_reason || "") + " " +
    (food.usage_es || ""),
  );
  return (
    (food.flags || []).includes("prepared") ||
    food.clean_protein === false ||
    /\b(ensalada|nugget\w*|rebozad\w*|empanad\w*|surimi|con salsa|rellen\w*|croqueta\w*|tempura)\b/.test(n) ||
    /\b(plato preparado|preparacion de pescado)\b/.test(context)
  );
}

function isFoodQuarantined(food) {
  return Boolean(
    food &&
    (food.quality_status === "quarantine" ||
      food.subgroup == null ||
      food.subgroup === "" ||
      food.subgroup === "?"),
  );
}

function isMarketEligibleFood(food) {
  if (!food) return false;
  if (norm(food.source || "") !== "openfoodfacts") return true;
  const status =
    food.market_provenance && food.market_provenance.status;
  return status === "verified_core_es" || status === "verified_spain_other";
}

// ============================================
// ALTERNATIVES CALCULATION (with tier system)
// ============================================
async function calculateAlternatives(originalFood, amount, opts = {}) {
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
    Number(window.BULK_LABEL_DEMOTION_MEAL_SLOT) || 0.4;
  const _demoteExotic =
    Number(window.BULK_LABEL_DEMOTION_EXOTIC)    || 0.7;
  const _demoteRare =
    Number(window.BULK_LABEL_DEMOTION_RARE)      || 0.5;
  // Frequency gap: cuando origen es "habitual" (consumo semanal en España)
  // y candidato es "ocasional" (mensual), el intercambio funciona pero NO
  // es ideal — preferimos otros habituales primero. Ej. Arroz (habitual)
  // → Quinoa cruda (ocasional) o Centeno crudo (ocasional).
  const _demoteFreqGap =
    Number(window.BULK_LABEL_DEMOTION_FREQ_GAP)  || 0.7;
  // meal_slot=any del candidato cuando el origen tiene un slot específico.
  // Light demote: "any" es comodín legítimo (queso, pan integral) pero NO
  // es preferible sobre un candidato con el mismo slot exacto.
  const _demoteMealSlotAny =
    Number(window.BULK_LABEL_DEMOTION_MEAL_ANY)  || 0.7;
  // POST-PILOT: ready_to_eat mismatch downgraded from hard filter to soft
  // demotion. Pescado crudo es nutricionalmente equivalente a cocinado.
  const _demoteUncooked =
    Number(window.BULK_LABEL_DEMOTION_UNCOOKED)  || 0.85;
  // Cooking state asymmetry (origin raw vs candidate cooked, or viceversa):
  // strong demotion. Las macros por 100g cambian dramáticamente con la
  // cocción — clínicamente erróneo mezclar estados.
  const _demoteCookingMismatch =
    Number(window.COOKING_STATE_DEMOTION) || 0.3;
  // Calorie-density mismatch: surrogate signal del estado de cocción cuando
  // el nombre no lo dice (ej. origen "Arroz" sin "crudo" pero kcal=360 → es
  // crudo de facto, vs "Patata asada" kcal=93 = cocida). Si misma category
  // pero diff relativa >20%, casi seguro están en estados distintos.
  const _demoteKcalDensity =
    Number(window.KCAL_DENSITY_DEMOTION) || 0.4;
  const _kcalDensityThreshold =
    Number(window.KCAL_DENSITY_THRESHOLD) || 0.2;
  // Same-subgroup boost: dentro de la misma category, premiar candidatos
  // que comparten subgroup con el origen. Arroz (grains) ↔ Quinoa (grains)
  // gana sobre Arroz ↔ Patata (tubers) aunque ambos sean carbs.
  const _subgroupBoost =
    Number(window.SAME_SUBGROUP_BOOST) || 0.10;
  // Cooking-input demotion: candidato es harina/sémola/almidón/copos pero
  // origen NO. Strong demote — clínicamente no son meal-equivalents.
  const _demoteCookingInput =
    Number(window.COOKING_INPUT_DEMOTION) || 0.25;
  // Non-staple grain demotion: candidato es centeno crudo, cebada cruda,
  // trigo entero, alpiste, sorgo, etc. y origen NO lo es. Aunque se hiervan
  // no se consumen como plato en España. Demote casi-eliminatorio.
  const _demoteNonStapleGrain =
    Number(window.NON_STAPLE_GRAIN_DEMOTION) || 0.1;
  // Breakfast-on-lunch: candidato es meal_slot="desayuno" y origen es "comida".
  // Más agresivo que el mismatch genérico — cereales de caja, bollería, etc.
  // no son intercambio de plato principal aunque cuadren en macros.
  const _demoteBreakfastOnLunch =
    Number(window.BREAKFAST_ON_LUNCH_DEMOTION) || 0.05;
  // Fat cross-subgroup bridge: dentro de category='fat', los aceites
  // (olive_oil, other_oils, butter_margarine) y los alimentos densos en
  // grasa (avocado, nuts_seeds, other_fat que alberga aceitunas/almendras)
  // viven en subgroups distintos. Sin este bridge, el same-subgroup boost
  // empuja "aceite de oliva → aceite de palma" arriba y deja aguacate/nueces
  // abajo. Igualamos el boost para que el cross-subgroup grasa-fuente
  // compita en pie de igualdad con la misma-familia.
  const _fatCrossSubgroupBoost =
    Number(window.FAT_CROSS_SUBGROUP_BOOST) || 0.10;
  // Protein bridge: cliente explicito para pollo "el pavo no puede salir
  // peor posicionado que nécora o cangrejo". Boost para proteína cotidiana
  // (meat / fish / eggs no-exotic, meal_dish) cuando origen también lo es.
  // Compensa el demote que R3 + mixed-macro aplican sobre proteínas
  // magras (pavo pechuga, merluza, bacalao) que matemáticamente pierden
  // calorías pero culinariamente SON el intercambio que la clienta usaría.
  const _proteinBridgeBoost =
    Number(window.PROTEIN_BRIDGE_BOOST) || 0.12;
  // Dairy sub-family logic (audit punto 4 del cliente):
  // - Same subfamily   → boost +0.12  (yogur griego ↔ skyr, queso fresco)
  // - Cross subfamily  → demote ×0.35 (yogur ↔ nata / queso curado / leche)
  // Cliente: "yogur griego no debería surfacear hummus light, queso fundido,
  // nata montada, leche almendras 382g, kéfir 350g, quesos curados".
  const _dairySubfamilyBoost =
    Number(window.DAIRY_SUBFAMILY_BOOST) || 0.12;
  const _dairyCrossSubfamilyDemotion =
    Number(window.DAIRY_CROSS_SUBFAMILY_DEMOTION) || 0.35;
  // R1: culinary role demotion. Cuando origen es meal_dish (arroz, pollo,
  // patata) y candidato es snack/recipe_ingredient/dessert, demote fuerte.
  // El cliente: "harina, snack o muy raro no debería salir arriba aunque
  // cuadre macros". El score se modula por la severidad del mismatch.
  const _demoteRoleSnack =
    Number(window.ROLE_SNACK_DEMOTION) || 0.30;          // ×0.30
  const _demoteRoleRecipeIngredient =
    Number(window.ROLE_INGREDIENT_DEMOTION) || 0.20;     // ×0.20 más fuerte
  const _demoteRoleDessert =
    Number(window.ROLE_DESSERT_DEMOTION) || 0.35;        // ×0.35
  // R2: exotic demotion. Cuando candidato es exotic (nécora, percebe,
  // pulmón, avestruz) y origen NO lo es, demote fuerte. Si origen TAMBIÉN
  // es exotic (clienta buscó "casquería"), no aplica.
  const _demoteExoticMismatch =
    Number(window.EXOTIC_MISMATCH_DEMOTION) || 0.25;     // ×0.25

  // PLANT PROTEIN BOOST (Hugo mail 16/05/2026 punto 2.E):
  // Cuando origen es tofu/tempeh/seitán/soja (subgroup=plant_protein),
  // los candidatos de su mismo cluster vegetal (plant_protein o legumes)
  // reciben un boost +0.30 para surfacear antes que pescados o carnes
  // (que cumplen subgroup compatible pero culinariamente no son la
  // primera opción de quien come tofu).
  const _plantProteinBoost =
    Number(window.PLANT_PROTEIN_BOOST) || 0.30;

  // CULTURAL PAIRS BOOST (nutricionista clínica + Hugo brief punto 2):
  // Pares de intercambio NATURAL en consulta privada España. Cuando origen
  // y candidato matchean una de estas parejas, su _sortScore recibe un
  // boost para que surfacee en top 1-3. Lista cerrada y conservadora —
  // solo los pares culturalmente OBVIOS para una mujer adulta española.
  //
  // Hugo: "Si busca pollo, lo lógico arriba sería: 1. Pavo." Estas reglas
  // codifican ese tipo de preferencia cultural sin inventar nutrición.
  //
  // Cada par es bidireccional: [tokenA, tokenB] aplica A→B y B→A.
  const _CULTURAL_PAIRS = [
    // Carnes magras hermanas
    ["pollo", "pavo"],
    // Pescado azul cotidiano
    ["atun", "bonito"],
    ["atún", "bonito"],
    ["salmon", "trucha"],
    ["salmón", "trucha"],
    // Pescado blanco hermanos
    ["merluza", "bacalao"],
    ["merluza", "rape"],
    // Huevo y derivados
    ["huevo", "tortilla"],
    ["huevo", "clara"],
    // Cereales hermanos
    ["arroz", "quinoa"],
    ["arroz", "cuscus"],
    ["arroz", "cuscús"],
    ["arroz", "bulgur"],
    ["pasta", "arroz"],
    // Tubérculos hermanos
    ["patata", "boniato"],
    ["patata", "batata"],
    // Lácteos hermanos
    ["yogur", "kefir"],
    ["yogur", "kéfir"],
    ["leche", "bebida vegetal"],
    ["leche", "bebida de avena"],
    ["leche", "bebida de almendra"],
    ["leche", "bebida de soja"],
    // Quesos frescos hermanos
    ["queso fresco", "requeson"],
    ["queso fresco", "requesón"],
    ["queso fresco", "mato"],
    ["queso fresco", "ricotta"],
    // Grasas hermanas (refuerza fat cluster)
    ["aceite", "aguacate"],
    ["aguacate", "nueces"],
    ["aguacate", "almendra"],
    ["aceitunas", "aguacate"],
    ["aceituna", "aguacate"],
    // Legumbres hermanas
    ["lenteja", "garbanzo"],
    ["lenteja", "alubia"],
    ["garbanzo", "alubia"],
    // Proteína vegetal (Hugo mail 16/05/2026 punto 2.E)
    ["tofu", "tempeh"],
    ["tofu", "seitan"],
    ["tofu", "seitán"],
    ["tofu", "soja"],
    ["tofu", "heura"],
    ["tofu", "legumbre"],
    ["tofu", "garbanzo"],
    ["tofu", "lenteja"],
    ["tempeh", "seitan"],
    ["tempeh", "soja"],
    ["seitan", "soja"],
  ];
  const _culturalPairBoost =
    Number(window.CULTURAL_PAIR_BOOST) || 0.25;  // boost fuerte, 1-3 surfaceo

  function _hasCulturalPair(originalName, candidateName) {
    if (!originalName || !candidateName) return false;
    const o = originalName.toLowerCase();
    const c = candidateName.toLowerCase();
    for (const [a, b] of _CULTURAL_PAIRS) {
      if (o.includes(a) && c.includes(b)) return true;
      if (o.includes(b) && c.includes(a)) return true;
    }
    return false;
  }

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

  // Read dietary filters fresh per call so toggles in the UI take effect
  // without a page reload. window.DIETARY_FILTERS is a Set or array of
  // strings: "vegetarian", "lactose_free". Empty / undefined → no filter.
  const _dietary = (typeof window !== "undefined") ? window.DIETARY_FILTERS : null;
  const _applyDietary = typeof window.passesDietaryFilters === "function" &&
    _dietary && (_dietary.size ? _dietary.size > 0 : _dietary.length > 0);

  // HARD FILTER: cuando origen es plato real (meal_dish/staple, ej. arroz,
  // pasta, pollo, huevo, pan) excluimos del POOL los candidatos que son
  // claramente NO meal-equivalents — harinas, sémolas, pan rallado, copos,
  // cereales crudos no-staple (centeno crudo, cebada cruda, trigo entero,
  // espelta entera, alpiste, sorgo, amaranto, etc.) y todo culinary_role
  // recipe_ingredient/dessert.
  //
  // Cliente: "harina, snack o muy raro no debería salir arriba aunque
  // cuadre macros". Demotions ×0.20 no alcanzaban — seguían visibles en
  // posición 9-14 del top. La única solución honesta es sacarlos del pool.
  //
  // Excepción: si origen ES recipe_ingredient/non-staple/cooking-input
  // (clienta buscó "harina de trigo" o "centeno crudo" directamente),
  // se permite porque ahí son familia natural.
  const _oRoleForFilter = originalFood.culinary_role || "meal_dish";
  const _originIsMealLike =
    (_oRoleForFilter === "meal_dish" || _oRoleForFilter === "staple") &&
    !isCookingInput(originalFood.name) &&
    !isNonStapleGrain(originalFood.name);

  // Premium v2: hard culinary-context gate. Nutritional similarity is only
  // evaluated after a candidate belongs to a compatible eating/use context.
  // Kill-switch for safe preview rollback:
  //   window.PREMIUM_CONTEXT_FILTER_ENABLED = false
  const _premiumContextEnabled =
    window.PREMIUM_CONTEXT_FILTER_ENABLED !== false &&
    typeof window.getPremiumContextCompatibility === "function";
  const _originPremiumContext =
    _premiumContextEnabled &&
    typeof window.inferPremiumContext === "function"
      ? window.inferPremiumContext(originalFood)
      : "unknown";
  const _originAllowsCondiments =
    ["seasoning", "condiment", "savory_sauce"].includes(
      _originPremiumContext,
    );
  const _originAllowsSweets =
    ["sweet_bakery", "sweet_dessert", "chocolate"].includes(
      _originPremiumContext,
    );

  const candidates = foodsDatabase.filter(
    (f) => {
      if (f.id === originalFood.id) return false;
      if (isFoodQuarantined(f)) return false;
      if (!isMarketEligibleFood(f)) return false;
      if (
        typeof window.isPremiumExchangeCandidateEligible === "function" &&
        !window.isPremiumExchangeCandidateEligible(f, originalFood)
      ) {
        return false;
      }
      if (!isCompatibleCategory(f, originalFood)) return false;
      if ((f.flags || []).includes("condiment") && !_originAllowsCondiments) {
        return false;
      }
      if ((f.flags || []).includes("sweet") && !_originAllowsSweets) {
        return false;
      }
      if (_applyDietary && !window.passesDietaryFilters(f, _dietary)) return false;
      if ((f.flags || []).includes("hidden")) return false;
      if (/\bdescatalogad\w*\b/.test(norm(f.name || ""))) return false;
      if (
        _premiumContextEnabled &&
        !window.getPremiumContextCompatibility(originalFood, f).compatible
      ) {
        return false;
      }
      if (
        opts.usageMode &&
        typeof window.getPremiumUsageCompatibility === "function" &&
        !window.getPremiumUsageCompatibility(f, opts.usageMode).compatible
      ) {
        return false;
      }

      // Origen proteico fresco: las marinadas, fiambres y conservas pueden
      // mostrarse como formatos secundarios, pero no como intercambio real.
      {
        const originProteinForm = proteinPreparationForm(originalFood);
        const candidateProteinForm = proteinPreparationForm(f);
        if (
          originalFood.category === "protein" &&
          originalFood.clean_protein === true &&
          originProteinForm === "fresh" &&
          ["prepared", "deli", "canned"].includes(candidateProteinForm)
        ) {
          return false;
        }
      }

      // Legumbre cocida/lista → legumbre cocida/lista. Evita sugerir gramos
      // en seco sin que la usuaria lo sepa.
      if (
        originalFood.subgroup === "legumes" &&
        !isDryLegume(originalFood) &&
        isDryLegume(f)
      ) {
        return false;
      }

      // Para un chocolate simple, menos resultados honestos es preferible a
      // completar el TOP con caramelos, galletas o frutos secos azucarados.
      if (
        originalFood.subgroup === "sweets_bakery" &&
        /\b(chocolate|cacao)\b/.test(norm(originalFood.name || "")) &&
        f.subgroup === "sweets_bakery" &&
        !/\b(chocolate|cacao|xocolata)\b/.test(norm(f.name || ""))
      ) {
        return false;
      }

      // La avena/copos simples y el pan no deben abrir con cereales de caja
      // o solubles aunque compartan macros y horario de desayuno.
      {
        const oShape = carbShape(originalFood);
        const originIsSimpleBreakfastCarb =
          originalFood.category === "carbs" &&
          (oShape === "flakes" || oShape === "bread") &&
          !isIndustrialBreakfastCereal(originalFood);
        if (originIsSimpleBreakfastCarb && isIndustrialBreakfastCereal(f)) {
          return false;
        }
      }

      // La carne picada conserva su función culinaria. Se permiten otras
      // carnes frescas, pero no fiambres, tiras preparadas ni conservas.
      {
        const originForm = proteinPreparationForm(originalFood);
        if (originForm === "minced") {
          const meatSubgroups = new Set(["meat", "meat_lean", "meat_fatty"]);
          if (f.category !== "protein" || !meatSubgroups.has(f.subgroup)) {
            return false;
          }
          const candidateForm = proteinPreparationForm(f);
          if (candidateForm === "deli" ||
              candidateForm === "prepared" ||
              candidateForm === "canned") {
            return false;
          }
        }
      }

      // Un pescado blanco simple no se sustituye por ensaladas, rebozados,
      // nuggets, surimi o platos con salsa.
      if (
        originalFood.category === "protein" &&
        originalFood.subgroup === "fish_white" &&
        !isPreparedFish(originalFood) &&
        isPreparedFish(f)
      ) {
        return false;
      }

      // Origin is a real plate / staple → exclude basura técnica del pool.
      if (_originIsMealLike) {
        const cRole = f.culinary_role || "meal_dish";
        if (cRole === "recipe_ingredient") return false;
        if (cRole === "dessert") return false;
        if (cRole === "snack") return false;
        if (isCookingInput(f.name)) return false;
        if (isNonStapleGrain(f.name)) return false;
      }

      // Hugo Regla 5 — Hidratos base (gate determinístico por flag clean_carb).
      // Cuando el origen es hidrato BASE limpio (arroz/avena/pan/pasta/patata/
      // legumbre/fruta entera — clean_carb:true), excluir del POOL todo carb
      // NO-limpio: snacks/galletas/cereales desayuno/prefritas/platos preparados/
      // dulces/bollería/azúcar puro (clean_carb:false).
      //
      // Reemplaza el viejo regex de cereales-desayuno (frágil ante marcas)
      // + filtro sweets_bakery solo para grains/tubers. Ahora cubre legumes
      // y fruit también, y usa flag estructurado independiente del idioma.
      // clean_carb está poblado en TODA la categoría carbs
      // (scripts/apply_clean_carb.js).
      {
        const _CLEAN_CARB_SUBGROUPS = new Set([
          "grains", "tubers", "legumes", "fruit", "vegetables",
        ]);
        const originIsCleanCarb =
          originalFood.category === "carbs" &&
          (originalFood.clean_carb === true ||
            (originalFood.clean_carb === undefined &&
              _CLEAN_CARB_SUBGROUPS.has(originalFood.subgroup)));
        if (originIsCleanCarb &&
            f.category === "carbs" &&
            f.clean_carb === false) {
          return false;
        }
      }

      // PUNTO 5: cuando origen es grasa PURA (aceite, aguacate, frutos
      // secos, aceitunas, semillas, mantequilla), excluir productos
      // marcados como "con aceite añadido" (atún en aceite, berenjena
      // frita, sofrito, vinagreta, tomate seco con aceite, etc.).
      // Cliente: "no es cambiar aguacate, es buscar cosas que llevan aceite".
      if (f.oil_added === true && originalFood.category === "fat" &&
          originalFood.oil_added !== true) {
        return false;
      }

      // Hugo Regla — Grasas limpias (gate determinístico por flag clean_fat).
      // Cuando el origen es grasa LIMPIA (aceite, aguacate, frutos secos,
      // semillas, aceitunas — clean_fat:true), excluir del POOL toda grasa
      // NO-limpia: salsas, embutido, queso-grasa, dulces, manteca/margarina,
      // dips y conservas pescado/verdura en aceite (clean_fat:false).
      //
      // Reemplaza el viejo regex de nombres (frágil ante grafías multilingües:
      // alioli/allioli, sobrasada/sobrassada, mayonesa/mayonnaise, etc.).
      // clean_fat está poblado en TODA la categoría fat
      // (scripts/apply_clean_fat.js). Fallback por subgrupo para datos viejos
      // sin flag. Candidatos sin flag = no-op backward-compatible.
      {
        const _CLEAN_FAT_SUBGROUPS = new Set([
          "olive_oil", "other_oils", "avocado", "nuts_seeds",
        ]);
        const originIsCleanFat =
          originalFood.category === "fat" &&
          (originalFood.clean_fat === true ||
            (originalFood.clean_fat === undefined &&
              _CLEAN_FAT_SUBGROUPS.has(originalFood.subgroup)));
        if (originIsCleanFat &&
            f.category === "fat" &&
            f.clean_fat === false) {
          return false;
        }
      }

      // Hugo Regla 4 — Fritos/rebozados/preparados (gate por flag clean_protein).
      // Cuando el origen es proteína FRESCA (huevo/pollo/pavo/pescado fresco —
      // clean_protein:true), excluir del POOL toda proteína procesada/transformada
      // (clean_protein:false): fritos, rebozados, empanados, nuggets, milanesas,
      // croquetas, tempura, salchichas, embutido curado (jamón serrano/chorizo/
      // salami/mortadela/sobrasada), patés, foie, surimi, conservas en aceite/
      // escabeche, snacks brand (Iberitos/Big Pavo/Wieners) y platos preparados.
      //
      // clean_protein poblado en TODA category=protein (scripts/apply_clean_protein.js).
      // Fallback subgrupo para backward-compat con datos viejos sin flag.
      {
        const _CLEAN_PROTEIN_SUBGROUPS = new Set([
          "meat_lean", "meat", "meat_fatty",
          "fish_white", "fish_fatty", "fish",
          "eggs", "viscera", "seafood",
          "plant_protein", "legumes",
        ]);
        const originIsCleanProtein =
          originalFood.category === "protein" &&
          (originalFood.clean_protein === true ||
            (originalFood.clean_protein === undefined &&
              _CLEAN_PROTEIN_SUBGROUPS.has(originalFood.subgroup)));
        if (originIsCleanProtein &&
            f.category === "protein" &&
            f.clean_protein === false) {
          return false;
        }
      }

      // Hugo audit (Feedback Elena) Bloque 2 bis — conserva/pescado graso NO trae
      // carne (HARD filter). Cuando el origen es pescado azul o marisco
      // (fish_fatty/seafood), la carne (cerdo/ternera/embutido lomo) NO es
      // intercambio válido: Hugo "conserva grasa debe ofrecer conservas
      // equivalentes — caballa, sardina, bonito/atún en aceite, melva similar".
      // El demote suave ×0.15 (línea ~1832) no basta en pools chicos (melva: 22
      // alts) porque el lomo ibérico/cabecero matchea por macro-grasa y aflora
      // en el top visible aunque tenga clean_protein:true. Acá lo sacamos del
      // pool. ASIMÉTRICO: solo fish→meat; el inverso (pollo→atún) sigue válido.
      // NO toca fish_white (ahí pollo/pavo SÍ es swap magro legítimo).
      {
        const _fishMeatHard =
          window.FISH_ORIGIN_MEAT_HARD === undefined
            ? true
            : window.FISH_ORIGIN_MEAT_HARD;
        const _FISH_FATTY_ORIGIN = new Set(["fish_fatty", "seafood"]);
        const _MEAT_SUBS = new Set(["meat", "meat_lean", "meat_fatty"]);
        if (
          _fishMeatHard &&
          originalFood.category === "protein" &&
          _FISH_FATTY_ORIGIN.has(originalFood.subgroup) &&
          f.category === "protein" &&
          _MEAT_SUBS.has(f.subgroup)
        ) {
          return false;
        }
      }

      // Hugo audit (Feedback Elena) Bloque 2 ter — pescado BLANCO/magro NO trae
      // carne GRASA (HARD ceiling de grasa). Hugo (merluza): "penalizar grasa
      // excesiva cuando el origen sea pescado blanco/proteína magra". NO es
      // "sacar toda la carne": pavo/pollo pechuga y lomo magro (3-6g grasa) son
      // swaps proteico-magros válidos y se MANTIENEN. Solo sale la carne con
      // grasa excesiva (cerdo graso 23g, costilla/cordero 16-18g). Por eso es
      // un techo de grasa absoluto, no un filtro por subgrupo. Distinto del
      // filtro fish_fatty de arriba (ahí el origen ya es graso y NINGUNA carne
      // pega; acá el origen es magro y la carne magra SÍ pega).
      {
        const _fatCeil =
          window.FISH_WHITE_MEAT_FAT_CEILING === undefined
            ? 10
            : window.FISH_WHITE_MEAT_FAT_CEILING;
        const _MEAT_SUBS_W = new Set(["meat", "meat_lean", "meat_fatty"]);
        if (
          _fatCeil > 0 &&
          originalFood.category === "protein" &&
          originalFood.subgroup === "fish_white" &&
          f.category === "protein" &&
          _MEAT_SUBS_W.has(f.subgroup) &&
          Number(f.fat) >= _fatCeil
        ) {
          return false;
        }
      }

      // Hugo Regla 3 — Grasos saciantes (HARD FLOOR kcal_ratio ≥ 0.75).
      // Cuando el origen es graso saciante (pescado azul, aguacate, frutos
      // secos, o mixed-macro fat-dominant alto-kcal), excluir del POOL todo
      // candidato con kcal_ratio < 0.75. Hugo: "no swap salmón 270 kcal por
      // magro 140 kcal aunque la proteína cuadre".
      //
      // Reemplaza el comportamiento de los soft demotes existentes (línea
      // 1859, 2143, 2149) cuando se cumple el criterio de graso saciante:
      // ellos siguen aplicando para otros casos (lean exchanges con kcal
      // floor menos estricto), pero acá hard-filtramos antes del scoring.
      {
        const _FATTY_SATIATING_SUBGROUPS = new Set([
          "fish_fatty", "avocado", "nuts_seeds",
        ]);
        const oKcal = originalFood.calories || 0;
        const oFat = originalFood.fat || 0;
        const oProt = originalFood.protein || 0;
        const oFatRatio = oKcal > 0 ? (oFat * 9) / oKcal : 0;
        const originIsFattySatiating =
          oKcal >= 150 && (
            _FATTY_SATIATING_SUBGROUPS.has(originalFood.subgroup) ||
            (["protein", "fat"].includes(originalFood.category) &&
              originalFood.subgroup !== "plant_protein" &&
              oFat >= 8 && oProt >= 5 && oFatRatio >= 0.4)
          );
        if (originIsFattySatiating && oKcal > 0 && f.calories > 0) {
          const ratio = f.calories / oKcal;
          if (ratio < 0.75) return false;
        }
      }

      // Hugo Regla 1 — Proteína vegetal (HARD whitelist).
      // Cuando origen es proteína vegetal (subgroup plant_protein: tofu,
      // tempeh, seitán, soja proteica), excluir del POOL claras, lácteos,
      // pescados y carnes. TOP debe priorizar vegetales. Hugo: "ahora sigue
      // metiendo demasiado arriba claras, lácteos o pescados".
      //
      // Whitelist estricta (permitidos): plant_protein + legumes (cross-
      // category protein↔carbs). Eggs EXCLUIDOS — Hugo explícito sobre
      // claras dominando TOP. Reemplaza el demote R10 soft (~1520) cuando
      // origen es plant_protein.
      {
        if (originalFood.category === "protein" &&
            originalFood.subgroup === "plant_protein") {
          const isPlant =
            f.category === "protein" && f.subgroup === "plant_protein";
          const isLegume =
            (f.category === "carbs" || f.category === "protein") &&
            f.subgroup === "legumes";
          const isProteinNoise = f.category === "protein" && !isPlant && !isLegume;
          const isDairy = f.category === "dairy";
          if (isProteinNoise || isDairy) return false;
          if (typeof window.isVegetarian === "function" &&
              !window.isVegetarian(f)) {
            return false;
          }
          // Legumbres listas/cocinables, no peso en seco sin aclararlo.
          if (isLegume && isDryLegume(f)) return false;
          // Los preparados vegetales densos pertenecen al bloque preparado,
          // no deben desplazar tofu, seitán o edamame del TOP real.
          if (
            /\b(burger\w*|hamburgues\w*|falafel\w*|croqueta\w*|empanad\w*|rebozad\w*)\b/.test(norm(f.name || "")) ||
            isCompositePreparedFood(f)
          ) {
            return false;
          }
        }
      }

      // Hugo audit (Feedback Elena) Bloque 3 — subfamilias lácteas (HARD).
      // Cuando origen y candidato son lácteos con subfamilia conocida y NO
      // compatible, excluir del POOL. Hugo: "separar leche simple / yogur-
      // kéfir-skyr / queso fresco / queso curado / postres-bebidas". La leche
      // no debe traer yogures/quesos/batidos; el yogur natural no debe traer
      // leche/café/Actimel/saborizados. Compatibilidad cruzada ÚNICA:
      // yogur_kefir ↔ queso_fresco (Hugo griego: "skyr, kéfir, queso fresco
      // batido"). dairy_subfamily refinado en scripts/refine_dairy_subfamily.js.
      // Hugo acepta "pocas opciones pero coherentes" (caso queso de Burgos).
      {
        // Hugo audit (Feedback Elena) Bloque 3 — subfamilias lácteas SEPARADAS
        // (HARD, no demote). Hugo refinó: "separar leche simple, yogur/kéfir/
        // skyr, queso fresco, queso curado". 4 clusters cerrados, NO mezclar.
        // Antes yogur_kefir↔queso_fresco era cross-compat ("queso fresco batido")
        // pero Hugo ahora pide separación: yogur griego traía cuajada/requesón/
        // Burgos al top. El demote cross-subfamilia (×0.35, ~2455) NO bastaba
        // (es ranking, lo pisa el rerank/sort del browser); el filtro de pool
        // (return false acá) SÍ saca el queso del candidato. Cada subfamilia
        // solo intercambia consigo misma.
        const _DAIRY_COMPAT = {
          leche: ["leche"],
          yogur_kefir: ["yogur_kefir"],
          queso_fresco: ["queso_fresco"],
          quesos_solidos: ["quesos_solidos"],
          grasa_lactea: ["grasa_lactea"],
          bebida_postre: ["bebida_postre"],
          bebida_vegetal: ["bebida_vegetal"],
          postres_lacteos: ["postres_lacteos"],
        };
        const oFam = originalFood.dairy_subfamily;
        const cFam = f.dairy_subfamily;
        if (
          originalFood.category === "dairy" && f.category === "dairy" &&
          oFam && _DAIRY_COMPAT[oFam] &&
          (!cFam || !_DAIRY_COMPAT[oFam].includes(cFam))
        ) {
          return false;
        }
      }

      // Hugo audit (Feedback Elena) Bloque 3 bis — lácteo natural NO trae
      // saborizados. Hugo (yogur natural): "no yogures saborizados. No mezclar
      // yogur natural con bebidas/café/batidos". La subfamilia (yogur_kefir)
      // NO distingue natural vs saborizado — ambos caen en yogur_kefir y no hay
      // campo estructurado (sin sugar/flavored flag). Detección por nombre:
      // cuando el ORIGEN lácteo NO es saborizado, excluir candidatos lácteos
      // con sabor/fruta en el nombre (arándano, coco, fresa, mango, cacao, café,
      // miel, cereales, etc.). Si el origen YA es saborizado, no aplica (yogur
      // de fresa → otros saborizados es válido). Gateado, reversible.
      {
        const _dairyFlavorExclude =
          window.DAIRY_FLAVOR_EXCLUDE === undefined
            ? true
            : window.DAIRY_FLAVOR_EXCLUDE;
        const _FLAVOR_RE = /(arandano|blueberr|myrtil|heidelbeer|fresa|strawberr|erdbeer|frambues|raspberr|melocoton|peach|platano|banana|cacao|chocolat|cioccolat|vainilla|vanilla|vanille|limon|lemon|naranja|orange|mango|pina|pineapple|coco|coconut|caramelo|caramel|galleta|cookie|frut[ao]s?|fruit|miel|honey|cafe|coffee|moka|mocha|tiramis|stracc|stratac|macedonia|cereza|cherry|higo|fig|granada|pomegranate|maracuy|passion|kiwi|sabor|sabores|flavou?r|pomelo|grapefruit|grosella|currant|bosque|toffee|tropical|dulce de leche|cereal|cereales|avena con)/;
        const _FERMENTED_DAIRY_RE =
          /\b(skyr|yogur|yogh|kefir|greek style|estilo griego|high protein natural)\b/;
        const _DESSERT_OR_CHEESE_RE =
          /\b(cottage|queso|quark|requeson|fromage|mousse|natilla|pudin|pudding|flan|budino|gelatina|postre|snack)\b/;
        const _originIsDairyLike =
          originalFood.category === "dairy" ||
          originalFood.category === "postres_proteicos";
        const _candidateIsDairyLike =
          f.category === "dairy" ||
          f.category === "postres_proteicos";
        if (
          _dairyFlavorExclude &&
          _originIsDairyLike && _candidateIsDairyLike &&
          !_FLAVOR_RE.test(norm(originalFood.name || "")) &&
          _FLAVOR_RE.test(norm(f.name || ""))
        ) {
          return false;
        }

        // La categoría histórica postres_proteicos contiene formatos culinarios
        // distintos (Skyr/yogur, cottage/quark, flanes, mousses y puddings).
        // Cuando el origen es yogur/kéfir/Skyr, sólo permitimos el cruce con
        // registros que el propio nombre identifica como fermentado natural.
        // Esto evita que un buen ajuste de macros convierta un Skyr en queso
        // cottage o postre de cuchara.
        const _originName = norm(originalFood.name || "");
        const _candidateName = norm(f.name || "");
        const _originIsFermentedDairy =
          originalFood.dairy_subfamily === "yogur_kefir" ||
          _FERMENTED_DAIRY_RE.test(_originName);
        if (
          _originIsFermentedDairy &&
          f.category === "postres_proteicos" &&
          (
            f.subgroup === "fresh_cheese" ||
            _DESSERT_OR_CHEESE_RE.test(_candidateName) ||
            !_FERMENTED_DAIRY_RE.test(_candidateName)
          )
        ) {
          return false;
        }
      }

      // Hugo audit (Feedback Elena) Bloque 5 — sopas frías (cluster cerrado).
      // Gazpacho/salmorejo/ajoblanco (flag cold_soup) sólo intercambian entre
      // sí. Antes traían encurtidos, salteados, crema de setas, tumaca, té/
      // café con leche. Hugo: "misma lógica culinaria o, si no existen, no
      // forzar". Si origen es sopa fría → sólo sopa fría; si candidato es sopa
      // fría y el origen no → fuera (no contamina búsquedas de verdura).
      // cold_soup poblado en scripts/reclassify_cold_soup.js. Si tras el
      // match calórico no queda nada, el pipeline devuelve noMatch.
      if (originalFood.cold_soup === true && f.cold_soup !== true) return false;
      if (f.cold_soup === true && originalFood.cold_soup !== true) return false;

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

  // Attempt semantic rerank — local embeddings primero, network como fallback.
  const ranked = await rerankCandidates(originalFood, allByScore);

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
  //   _sortScore   = _hybridScore + afinidad + calidad de fuente
  //                  Usado para ORDENAR dentro de cada tier. Hace que la
  //                  misma fuente/familia gane cuando el match es razonable,
  //                  pero permite cross-family si la diferencia de match es
  //                  grande (>~30 puntos).
  const withHybrid = sorted.map(a => {
    const hybrid = 0.65 * (a.matchScore / 100) + 0.35 * (a._semanticScore || 0);
    const affinityBonus = sourceAffinityBonus(a, originalFood);
    const provenanceBonus = sourceQualityBonus(a);
    const premiumContext = _premiumContextEnabled
      ? window.getPremiumContextCompatibility(originalFood, a)
      : { compatible: true, priority: 0, origin: null, candidate: null, reason: "disabled" };
    // Same-subgroup boost: dentro de la misma category, mismo subgroup gana.
    // Arroz (grains) ↔ Quinoa (grains) > Arroz ↔ Patata (tubers).
    const subgroupBonus = (
      a.subgroup && originalFood.subgroup &&
      a.subgroup === originalFood.subgroup
    ) ? _subgroupBoost : 0;

    // Fat cross-subgroup bridge: aceites ↔ frutos secos / aguacate /
    // aceitunas. Sin esto, "aceite oliva → aceite palma" gana por
    // same-subgroup contra "aceite oliva → aguacate/nueces", pero
    // clínicamente y para una clienta real las grasas vegetales densas
    // SON el intercambio útil de aceite. Aplica solo cuando subgroups
    // SON DISTINTOS (si coinciden, ya tienen subgroupBonus arriba).
    const _OIL_SUBS = new Set([
      "olive_oil",
      "other_oils",
      "butter_margarine",
    ]);
    const _DENSE_FAT_SUBS = new Set([
      "avocado",
      "nuts_seeds",
      "other_fat", // aceitunas, almendras, avellanas
    ]);
    // Keyword fallback for tahin / crema de cacahuete / semillas / pasta
    // de almendras — viven en subgroups variables pero clínicamente son
    // grasas reales intercambiables. Detectamos por nombre normalizado.
    const _FAT_BRIDGE_NAME_RE =
      /\b(tahin|crema de cacahuete|pasta de almendra|pasta de avellana|mantequilla de cacahuete|peanut butter|tahini|semilla(s)? de (sesamo|chia|lino|girasol|calabaza))\b/i;
    const osub = originalFood.subgroup || "";
    const csub = a.subgroup || "";
    const oname = (originalFood.name || "").toLowerCase();
    const cname = (a.name || "").toLowerCase();

    // PLANT CLUSTER ESCAPE HATCH (sort scope) — paralelo al lean protein
    // cluster. Cuando origen y candidato son ambos del cluster vegetal
    // (plant_protein/legumbres), los intercambios IDEALES (tofu↔tempeh/
    // seitán/soja) NO deben hundirse por democión de frecuencia (ocasional/
    // raro), exotic ni kcal-density. Si no, legumbres "habituales" con 0%
    // de match macro ganan al swap correcto de misma familia. Hugo bloque 1
    // pide proteína vegetal real arriba, no legumbre genérica con 0%.
    const _PLANT_CLUSTER_SORT = new Set(["plant_protein", "legumes"]);
    const isSamePlantClusterSort =
      _PLANT_CLUSTER_SORT.has(osub) && _PLANT_CLUSTER_SORT.has(csub);
    const oIsOil       = _OIL_SUBS.has(osub);
    const cIsOil       = _OIL_SUBS.has(csub);
    const oIsDenseFat  = _DENSE_FAT_SUBS.has(osub) || _FAT_BRIDGE_NAME_RE.test(oname);
    const cIsDenseFat  = _DENSE_FAT_SUBS.has(csub) || _FAT_BRIDGE_NAME_RE.test(cname);
    const fatBridgeBonus = (
      a.category === "fat" && originalFood.category === "fat" &&
      osub !== csub &&
      ((oIsOil && cIsDenseFat) || (oIsDenseFat && cIsOil) ||
       // Cross-dense-fat: aguacate ↔ nueces, aceitunas ↔ tahín, etc.
       (oIsDenseFat && cIsDenseFat))
    ) ? _fatCrossSubgroupBoost : 0;

    // PROTEIN BRIDGE: ambos category=protein, meal_dish, no-exotic,
    // subgroups de proteína cotidiana (meat/fish/eggs). Boost simétrico
    // para que pavo / merluza / bacalao / atún / huevo compitan en pie de
    // igualdad como intercambio de pollo (y viceversa), no pierdan contra
    // cerdo grande por cuestiones de R3 calorie floor.
    const _COMMON_PROTEIN_SUBS = new Set([
      "meat", "meat_lean", "meat_fatty",
      "fish", "fish_white", "fish_fatty",
      "eggs", "other_protein",
    ]);
    const proteinBridgeBonus = (
      a.category === "protein" && originalFood.category === "protein" &&
      (a.culinary_role || "meal_dish") === "meal_dish" &&
      (originalFood.culinary_role || "meal_dish") === "meal_dish" &&
      a.exotic !== true && originalFood.exotic !== true &&
      _COMMON_PROTEIN_SUBS.has(osub) && _COMMON_PROTEIN_SUBS.has(csub)
    ) ? _proteinBridgeBoost : 0;

    // DAIRY SUB-FAMILY BRIDGE: boost cuando ambos son lácteos de la misma
    // subfamilia culinaria (frescos_proteicos, quesos_solidos, etc.).
    // 0 si distinta o si uno de los dos no es dairy.
    const oDairyFam = originalFood.dairy_subfamily;
    const cDairyFam = a.dairy_subfamily;
    const dairyFamilyBonus = (
      oDairyFam && cDairyFam && oDairyFam === cDairyFam
    ) ? _dairySubfamilyBoost : 0;

    // CARB SHAPE BRIDGE (Hugo Feedback Elena ajuste avena/pan): boost cuando
    // origen y candidato son hidratos de la MISMA forma culinaria (pan↔pan,
    // avena↔copos/cereal, pasta↔pasta, arroz↔grano, patata↔tubérculo). El
    // demote inverso (forma distinta) está abajo en la sección de demotion.
    const oCarbShape = carbShape(originalFood);
    const cCarbShape = carbShape(a);
    const carbShapeBonus = (
      oCarbShape && cCarbShape && oCarbShape === cCarbShape
    ) ? (Number(window.CARB_SHAPE_BOOST) || 0.80) : 0;

    const proteinFormBonus = (
      proteinPreparationForm(originalFood) === "minced" &&
      proteinPreparationForm(a) === "minced"
    ) ? (Number(window.PROTEIN_FORM_BOOST) || 0.75) : 0;

    const vegetableContextBonus = (
      originalFood.category === "vegetables" &&
      a.category === "vegetables" &&
      originalFood.subgroup &&
      originalFood.subgroup === a.subgroup &&
      culinaryPresentation(originalFood) === culinaryPresentation(a)
    ) ? (Number(window.VEGETABLE_CONTEXT_BOOST) || 0.35) : 0;

    const whiteFishCohortBonus = (
      originalFood.category === "protein" &&
      originalFood.subgroup === "fish_white" &&
      a.category === "protein" &&
      a.subgroup === "fish_white" &&
      !isPreparedFish(a)
    ) ? (Number(window.WHITE_FISH_COHORT_BOOST) || 0.65) : 0;

    // CULTURAL PAIRS BOOST: parejas naturales (pollo↔pavo, huevo↔tortilla,
    // leche↔bebida vegetal, etc.). Hugo brief punto 2 explícito.
    const culturalPairBonus =
      _hasCulturalPair(originalFood.name, a.name) ? _culturalPairBoost : 0;

    // PLANT PROTEIN BOOST (Hugo brief 16/05/2026 punto 2.E):
    // Jerarquía cuando origen es tofu/tempeh/seitán/soja:
    //   1. otros plant_protein y legumes       → boost +0.30
    //   2. eggs (huevo)                         → boost +0.20 ("huevo si encaja")
    //   3. fresh_cheese, high_protein_dairy     → boost +0.15 ("queso fresco/requesón")
    //
    // Penalización en el demote inverso más abajo (R10_PP_FISH/MEAT).
    let plantProteinBonus = 0;
    if (originalFood.subgroup === "plant_protein") {
      if (a.subgroup === "plant_protein" || a.subgroup === "legumes") {
        plantProteinBonus = _plantProteinBoost;          // +0.30
      } else if (a.subgroup === "eggs") {
        plantProteinBonus = 0.20;
      } else if (a.subgroup === "fresh_cheese" || a.subgroup === "high_protein_dairy") {
        plantProteinBonus = 0.30;   // Hugo: "queso fresco/requesón si encaja"
      }
    }
    if (culturalPairBonus > 0 && window.location.search.includes('?debug=1')) {
      console.debug('[cultural-pair] BOOST candidate=\'' + a.name + '\' +' + culturalPairBonus);
    }

    // Soft demotions from bulk-label flags. Multiplicative, applied on top of
    // the additive sourceAffinityBonus. No-op when flags absent (strict equality
    // means undefined !== true / undefined !== "raro" — graceful degradation).
    let demotion = 1;

    if (
      opts.usageMode &&
      opts.usageMode !== "any" &&
      typeof window.getPremiumUsageCompatibility === "function"
    ) {
      const usageCompatibility = window.getPremiumUsageCompatibility(
        a,
        opts.usageMode,
      );
      if (usageCompatibility.priority > 0) {
        demotion *= Number(window.PREMIUM_USAGE_SECONDARY_DEMOTION) || 0.55;
      }
      if (typeof window.getPremiumIntentProfile === "function") {
        const originIntent = window.getPremiumIntentProfile(originalFood);
        const candidateIntent = window.getPremiumIntentProfile(a);
        const proteinFamilies = new Set([
          "meat",
          "fish",
          "plant_protein",
          "egg",
        ]);
        if (
          proteinFamilies.has(originIntent.family) &&
          proteinFamilies.has(candidateIntent.family) &&
          originIntent.family !== candidateIntent.family
        ) {
          demotion *=
            Number(window.PREMIUM_USAGE_PROTEIN_FAMILY_DEMOTION) || 0.35;
        }
      }
    }

    // Una equivalencia exacta puede requerir una ración grande por diferencias
    // de agua o densidad. Se conserva como alternativa secundaria y la interfaz
    // lo explica; nunca debe desplazar silenciosamente a una ración práctica.
    if (a.premiumPortionStatus === "review") {
      demotion *= Number(window.PREMIUM_PORTION_REVIEW_DEMOTION) || 0.72;
    }

    // Same culinary context is intentionally neutral. Same-cohort options
    // remain useful but sit behind the closest form; explicit bridges such
    // as breakfast cereal↔bread or milk↔plant drink are secondary.
    if (premiumContext.priority === 1) {
      demotion *= Number(window.PREMIUM_CONTEXT_COHORT_DEMOTION) || 0.90;
    } else if (premiumContext.priority >= 2) {
      demotion *= Number(window.PREMIUM_CONTEXT_BRIDGE_DEMOTION) || 0.55;
    }

    if (
      originalFood.category === "protein" &&
      originalFood.subgroup === "fish_white" &&
      a.category === "protein" &&
      a.subgroup === "fish_fatty"
    ) {
      demotion *= Number(window.WHITE_FISH_FATTY_DEMOTION) || 0.35;
    }

    // PLANT PROTEIN demote inverso (Hugo punto 2.E): cuando origen es
    // plant_protein (tofu, tempeh, seitán, soja), los pescados/mariscos/
    // carnes NO son intercambio cultural natural. Hugo: "tofu no debería
    // abrir con chanquete, ostras, mejillones o pijota".
    //
    // Jerarquía de demote:
    //   - mariscos exóticos (calamar, pulpo, langosta, ostra, mejillón,
    //     chanquete, percebe) → ×0.05 (casi-eliminatorio)
    //   - pescado blanco/azul normal                            → ×0.15
    //   - carnes magras/grasas                                  → ×0.15
    //   - vísceras                                              → ×0.05
    if (originalFood.subgroup === "plant_protein") {
      const cName = norm(a.name || "");
      const _MARISCO_EXOTICO_RE =
        /\b(calamares?|pulpos?|langostas?|ostras?|mejillones?|mejill[oó]n|chanquetes?|percebes?|cigalas?|n[eé]coras?|bogavantes?|sepias?|chipirones?|chipir[oó]n|gambas?|langostinos?|cangrejos?|centollos?|vieiras?|navajas?|berberechos?|almejas?|caracoles?|caracol|huevas?|caviar|camarones?|camar[oó]n|brecas?|fanecas?|rayas?|fletanes?|fletan|fletán|carabineros?|pijotas?)\b/i;
      if (_MARISCO_EXOTICO_RE.test(cName)) {
        demotion *= 0.05;
        if (window.location.search.includes('?debug=1')) {
          console.debug('[plant-protein-marisco] DEMOTED candidate=\'' + a.name + '\' factor=0.05 (marisco/exótico)');
        }
      } else if (a.subgroup === "fish_white" || a.subgroup === "fish_fatty") {
        demotion *= 0.15;
        if (window.location.search.includes('?debug=1')) {
          console.debug('[plant-protein-fish] DEMOTED candidate=\'' + a.name + '\' factor=0.15');
        }
      } else if (a.subgroup === "meat_lean" || a.subgroup === "meat_fatty" || a.subgroup === "meat") {
        demotion *= 0.15;
        if (window.location.search.includes('?debug=1')) {
          console.debug('[plant-protein-meat] DEMOTED candidate=\'' + a.name + '\' factor=0.15');
        }
      } else if ((a.subgroup === "viscera" || a.exotic === true) && !isSamePlantClusterSort) {
        // Escape: seitán está flageado exotic pero es plant_protein y ES el
        // intercambio correcto de tofu. No lo demotamos dentro del cluster.
        demotion *= 0.05;
        if (window.location.search.includes('?debug=1')) {
          console.debug('[plant-protein-exotic] DEMOTED candidate=\'' + a.name + '\' factor=0.05');
        }
      }
    }

    // Hugo audit (Feedback Elena) Bloque 2 + ajuste salmón/caballa/merluza:
    // cuando el ORIGEN es pescado/marisco (fish_fatty/fish_white/seafood),
    // la carne (jamón/lomo ibérico, cerdo, ternera, pollo) NO es intercambio
    // de cocina natural y NO debe dominar el TOP visible de una conserva o
    // pescado fresco. Demote moderado (no eliminatorio: Hugo "el puesto 40 no
    // importa", se mantiene en el pool). ASIMÉTRICO a propósito: el sentido
    // inverso (origen carne → candidato pescado, ej. pollo→atún) NO se toca,
    // sigue siendo intercambio válido de proteína magra (Hugo "casi cerrado").
    // Corre SIEMPRE: ignora isSameLeanProteinCluster, que es justo lo que hoy
    // protege mal al jamón ibérico al lado de la conserva de pescado.
    {
      const _demoteFishOriginMeat =
        Number(window.FISH_ORIGIN_MEAT_DEMOTION) || 0.15;
      const _FISH_ORIGIN_SUBS = new Set(["fish_fatty", "fish_white", "seafood"]);
      const _MEAT_CAND_SUBS = new Set(["meat", "meat_lean", "meat_fatty"]);
      if (
        originalFood.category === "protein" &&
        _FISH_ORIGIN_SUBS.has(originalFood.subgroup) &&
        _MEAT_CAND_SUBS.has(a.subgroup)
      ) {
        demotion *= _demoteFishOriginMeat;
        if (window.location.search.includes("?debug=1")) {
          console.debug("[fish-origin-meat] DEMOTED candidate='" + a.name + "' factor=" + _demoteFishOriginMeat);
        }
      }
    }

    // Hugo Feedback Elena (ajuste avena/pan): demote suave cuando origen y
    // candidato son hidratos de FORMA distinta (pan vs patata, avena vs maíz).
    // No eliminatorio: el intercambio cross-forma es válido (cuadra macros),
    // pero la misma forma debe ir primero en el TOP visible.
    if (oCarbShape && cCarbShape && oCarbShape !== cCarbShape) {
      let shapeDemotion = Number(window.CARB_SHAPE_CROSS_DEMOTION) || 0.25;
      if (oCarbShape === "flakes" && cCarbShape === "bread") {
        shapeDemotion = 0.65;
      } else if (oCarbShape === "flakes" && cCarbShape === "grain") {
        shapeDemotion = 0.45;
      } else if (oCarbShape === "flakes" && cCarbShape === "pasta") {
        shapeDemotion = 0.08;
      }
      demotion *= shapeDemotion;
      if (window.location.search.includes("?debug=1")) {
        console.debug("[carb-shape] DEMOTED candidate='" + a.name + "' " + oCarbShape + "->" + cCarbShape);
      }
    }

    // Hugo audit (Feedback Elena) Bloque 5 bis — cereal base simple prioriza
    // sobre cereal de desayuno graso. Hugo (avena): "debería priorizar más
    // avena/cereal base simple". Cuando el origen es un cereal base magro
    // (grains, grasa < 9g: avena 6.6, quinoa 5.6, pasta 2, cuscús 3.3, arroz),
    // demote los cereales grains con grasa excesiva (≥9g: Corazón fundente 12,
    // P'tit Déj 14, granola/muesli) que NO son base simple. NO eliminatorio
    // (siguen siendo cereal, no basura): solo bajan en el TOP visible para que
    // suban pasta/cuscús/arroz/quinoa. Asimétrico: si el origen ya es graso
    // (granola), no aplica.
    {
      const _grainFatCeil =
        window.GRAIN_BASE_FAT_CEILING === undefined
          ? 9
          : window.GRAIN_BASE_FAT_CEILING;
      const _grainFatDemote =
        Number(window.GRAIN_BASE_FAT_DEMOTION) || 0.25;
      if (
        _grainFatCeil > 0 &&
        originalFood.subgroup === "grains" &&
        Number(originalFood.fat) < _grainFatCeil &&
        a.subgroup === "grains" &&
        Number(a.fat) >= _grainFatCeil
      ) {
        demotion *= _grainFatDemote;
        if (window.location.search.includes("?debug=1")) {
          console.debug("[grain-base-fat] DEMOTED candidate='" + a.name + "' fat=" + a.fat);
        }
      }
    }

    if (_bulkLabelEnabled) {
      // Meal slot mismatch (origin breakfast → candidate dinner) — demote.
      // "any" del candidato cuando origen tiene slot específico = light demote.
      if (
        originalFood.meal_slot && a.meal_slot &&
        originalFood.meal_slot !== "any" && a.meal_slot !== "any" &&
        originalFood.meal_slot !== a.meal_slot
      ) {
        demotion *= _demoteMealSlot;   // default 0.6
        if (window.location.search.includes('?debug=1')) {
          console.debug('[bulk-label] DEMOTED candidate=\'' + a.name + '\' factor=' + _demoteMealSlot + ' reason=meal_slot_mismatch');
        }
      } else if (
        originalFood.meal_slot && a.meal_slot &&
        originalFood.meal_slot !== "any" && a.meal_slot === "any"
      ) {
        demotion *= _demoteMealSlotAny;  // default 0.85
        if (window.location.search.includes('?debug=1')) {
          console.debug('[bulk-label] DEMOTED candidate=\'' + a.name + '\' factor=' + _demoteMealSlotAny + ' reason=meal_slot_any_vs_specific');
        }
      }
      // Candidate exotic but origin is not (Pollo → Cangrejo).
      // Escape: dentro del cluster vegetal no penalizamos exotic (seitán es
      // exotic pero ES el intercambio correcto de tofu).
      if (a.exotic === true && originalFood.exotic !== true && !isSamePlantClusterSort) {
        demotion *= _demoteExotic;     // default 0.7
        if (window.location.search.includes('?debug=1')) {
          console.debug('[bulk-label] DEMOTED candidate=\'' + a.name + '\' factor=' + _demoteExotic + ' reason=exotic');
        }
      }
      // Frequency gap (origin-aware). En contexto España:
      //   habitual → habitual: no demote (intercambio ideal)
      //   habitual → ocasional: ×0.7 (no es ideal pero válido)
      //   habitual → raro: ×0.5 (clínicamente forzado)
      //   ocasional → raro: ×0.6
      //   ocasional/raro → habitual: no demote (acepta substitutos comunes)
      //   ocasional → ocasional: no demote
      //   raro → cualquier: no demote (si origen es raro, abierto a todo)
      {
        const oFreq = originalFood.frequency;
        const cFreq = a.frequency;
        let freqDemote = 1;
        let freqReason = null;
        if (oFreq === "habitual") {
          if (cFreq === "ocasional") { freqDemote = _demoteFreqGap; freqReason = "habitual_to_ocasional"; }
          else if (cFreq === "raro") { freqDemote = _demoteRare; freqReason = "habitual_to_raro"; }
        } else if (oFreq === "ocasional") {
          if (cFreq === "raro") { freqDemote = (_demoteRare + _demoteFreqGap) / 2; freqReason = "ocasional_to_raro"; }
        }
        // Escape: dentro del cluster vegetal no aplicamos freq-gap. Tempeh/
        // soja son "ocasional" pero son el swap ideal de tofu.
        if (freqDemote < 1 && !isSamePlantClusterSort) {
          demotion *= freqDemote;
          if (window.location.search.includes('?debug=1')) {
            console.debug('[bulk-label] DEMOTED candidate=\'' + a.name + '\' factor=' + freqDemote + ' reason=freq_' + freqReason);
          }
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
      // BREAKFAST-ON-LUNCH: candidato de desayuno cuando origen es comida.
      // Más agresivo que el mismatch genérico ya aplicado arriba — cereales
      // de caja, granola, bollería, etc. no son intercambio de plato principal.
      if (
        a.meal_slot === "desayuno" &&
        originalFood.meal_slot === "comida"
      ) {
        demotion *= _demoteBreakfastOnLunch;
        if (window.location.search.includes('?debug=1')) {
          console.debug('[bulk-label] DEMOTED candidate=\'' + a.name + '\' factor=' + _demoteBreakfastOnLunch + ' reason=breakfast_on_lunch');
        }
      }
    }

    // ESCAPE HATCH: cuando origen y candidato son ambos PROTEÍNAS MAGRAS
    // hermanas (pollo, pavo, ternera magra, pescados, huevo — no exotic),
    // las reglas de cooking-state / kcal-density / mixed-macro NO aplican.
    //
    // Razonamiento clínico (nutricionista 20+ años): si una mujer compra
    // pollo crudo y la BD tiene pavo a la plancha (cocido), intercambiar
    // ESOS macros es VÁLIDO porque así lo va a comer ella en el plato.
    // Las reglas de cocción están pensadas para granos (arroz crudo vs
    // hervido = macros muy distintas) y mixtos verdaderos (huevo, salmón,
    // aguacate), no para el cluster proteico magro.
    //
    // Hugo brief punto 2: "Si busca pollo, el pavo no puede salir peor
    // posicionado que nécora o cangrejo. Matemáticamente puede cuadrar
    // algo peor por grasa, pero como intercambio real de cocina es
    // mucho más útil." → este escape implementa esa intención.
    const _LEAN_PROTEIN_CLUSTER = new Set([
      "meat_lean", "meat", "meat_fatty",
      "fish_white", "fish_fatty",
      "eggs",
    ]);
    const isSameLeanProteinCluster =
      originalFood.category === "protein" && a.category === "protein" &&
      _LEAN_PROTEIN_CLUSTER.has(originalFood.subgroup) &&
      _LEAN_PROTEIN_CLUSTER.has(a.subgroup) &&
      a.exotic !== true && originalFood.exotic !== true &&
      (a.culinary_role || "meal_dish") === "meal_dish" &&
      (originalFood.culinary_role || "meal_dish") === "meal_dish";

    // CLINICAL: cooking state symmetry. Independiente de bulk-label flags
    // (corre siempre, basado en regex sobre el nombre). Si origen=raw y
    // candidato=cooked (o al revés), demotion fuerte. Si alguno es 'neutral',
    // no penaliza (la mayoría de foods no marcan estado).
    // EXCEPCIÓN: proteínas magras hermanas (ver escape hatch arriba).
    {
      const _originState   = getCookingState(originalFood.name);
      const _candidateState = getCookingState(a.name);
      if (
        !isSameLeanProteinCluster &&
        !isSamePlantClusterSort &&
        _originState !== "neutral" &&
        _candidateState !== "neutral" &&
        _originState !== _candidateState
      ) {
        demotion *= _demoteCookingMismatch;
        if (window.location.search.includes('?debug=1')) {
          console.debug('[cooking-state] DEMOTED candidate=\'' + a.name + '\' factor=' + _demoteCookingMismatch + ' reason=' + _originState + '_vs_' + _candidateState);
        }
      }
    }

    // CLINICAL: cooking-input asymmetry. Si el candidato es harina/sémola/
    // almidón/copos deshidratados y el origen NO lo es, demote fuerte.
    // Una persona no come 120g de "harina de trigo" como intercambio de
    // 100g de arroz — la harina es insumo de cocina, no meal-equivalent.
    {
      const _oCookingInput = isCookingInput(originalFood.name);
      const _cCookingInput = isCookingInput(a.name);
      if (_cCookingInput && !_oCookingInput) {
        demotion *= _demoteCookingInput;
        if (window.location.search.includes('?debug=1')) {
          console.debug('[cooking-input] DEMOTED candidate=\'' + a.name + '\' factor=' + _demoteCookingInput + ' reason=harina_o_copos_deshidratados');
        }
      }
    }

    // CLINICAL: non-staple grain. Cebada cruda, centeno crudo, trigo entero,
    // espelta entera, alpiste, sorgo, amaranto, teff, kamut, kasha. Aunque
    // se hiervan, no son plato principal en España. Si origen no es
    // tampoco non-staple → demote casi-eliminatorio.
    {
      const _oNonStaple = isNonStapleGrain(originalFood.name);
      const _cNonStaple = isNonStapleGrain(a.name);
      if (_cNonStaple && !_oNonStaple) {
        demotion *= _demoteNonStapleGrain;
        if (window.location.search.includes('?debug=1')) {
          console.debug('[non-staple-grain] DEMOTED candidate=\'' + a.name + '\' factor=' + _demoteNonStapleGrain + ' reason=grano_crudo_no_plato_es');
        }
      }
    }

    // CLINICAL: calorie-density mismatch (cooking state surrogate). Cuando
    // el nombre no marca estado pero las macros por 100g sí lo delatan.
    // Solo aplica intra-SUBGROUP (no comparar grains vs tubers — la app
    // ya calcula gramaje equivalente para cross-subgroup, ej. 374g boniato
    // cocido = 100g arroz crudo en calorías, intercambio clínico válido).
    // Sirve para detectar "Arroz crudo (360 kcal)" vs "Arroz hervido (130 kcal)"
    // dentro de sub:grains — son la misma cosa en estados distintos.
    // EXCEPCIÓN: lean protein cluster (pollo/pavo magros distintos cortes
    // varían naturalmente en kcal por % grasa — no es bug de estado).
    {
      const oKcal = originalFood.calories;
      const cKcal = a.calories;
      if (
        !isSameLeanProteinCluster &&
        !isSamePlantClusterSort &&
        oKcal != null && cKcal != null &&
        originalFood.subgroup && a.subgroup &&
        originalFood.subgroup === a.subgroup
      ) {
        const diff  = Math.abs(oKcal - cKcal);
        const denom = Math.max(oKcal, cKcal, 100);
        if (diff / denom > _kcalDensityThreshold) {
          demotion *= _demoteKcalDensity;
          if (window.location.search.includes('?debug=1')) {
            console.debug('[kcal-density] DEMOTED candidate=\'' + a.name + '\' factor=' + _demoteKcalDensity + ' diff_ratio=' + (diff/denom).toFixed(2) + ' (' + oKcal + ' vs ' + cKcal + ')');
          }
        }
      }
    }

    // CLINICAL: mixed macro coherence (punto 3 del cliente).
    // Para alimentos MIXTOS REALES (huevo, salmón, yogur griego entero,
    // aguacate, hummus, queso fresco entero, frutos secos) donde proteína
    // Y grasa son ambas significativas, NO basta con igualar proteína —
    // hay que respetar grasa Y calorías conjuntamente.
    //
    // Cliente: "si una clienta cambia 2 huevos por merluza/rape/panga/
    // langostino, pierde mucha energía y saciedad. Luego a las 23:30
    // aparece el monstruo del armario de las galletas."
    //
    // CRITERIO CLÍNICO REFINADO: "mixto verdadero" = ratio F/P >= 0.6 Y
    // fat absoluto >= 8g/100g. Pollo con piel (F=9, P=21, F/P=0.43)
    // NO es mixto — su intercambio natural ES pavo magro (Hugo punto 2).
    // Además, exemption explícita para lean protein cluster (escape hatch).
    //
    // Doble check:
    //   (a) fat-loss > 50% → demote
    //   (b) calorie-loss > 25% → demote (umbral exacto del cliente)
    // El demote final = mínimo de los dos (el más estricto manda).
    {
      const _oP = originalFood.protein || 0;
      const _oF = originalFood.fat || 0;
      const _fpRatio = _oP > 0 ? _oF / _oP : 0;
      const isMixedMacroOrigin =
        _oP > 5 && _oF >= 8 && _fpRatio >= 0.6;
      if (isMixedMacroOrigin && !isSameLeanProteinCluster && a.macros) {
        let mixedDemotion = 1;

        // (a) Fat-loss check
        if (originalMacros.fat > 0 && a.diffs) {
          const fatLoss = a.diffs.fat < 0 ? Math.abs(a.diffs.fat) : 0;
          const fatLossRatio = fatLoss / originalMacros.fat;
          if (fatLossRatio > 0.5) {
            // 0.51 → ×0.59  |  0.75 → ×0.40  |  1.0 → ×0.20
            mixedDemotion = Math.min(mixedDemotion, Math.max(0.20, 1 - fatLossRatio));
          }
        }

        // (b) Calorie-loss check (umbral 25% del cliente)
        if (originalMacros.calories > 0) {
          const calRatio = a.macros.calories / originalMacros.calories;
          if (calRatio < 0.75) {
            // 0.74 → ×0.74  |  0.50 → ×0.50  |  0.30 → ×0.30
            // Más agresivo que R3 genérico porque acá el origen es MIXTO.
            mixedDemotion = Math.min(mixedDemotion, Math.max(0.20, calRatio));
          }
        }

        if (mixedDemotion < 1) {
          demotion *= mixedDemotion;
          if (window.location.search.includes('?debug=1')) {
            console.debug('[mixed-macro] DEMOTED candidate=\'' + a.name + '\' factor=' + mixedDemotion.toFixed(2));
          }
        }
      }
    }

    // R1 CULINARY ROLE: si origen es meal_dish/staple y candidato es
    // snack/recipe_ingredient/dessert, el intercambio NO es práctico
    // aunque cuadre macros. Cliente: "una mujer no cambia 60g de arroz
    // por harina cruda o por bolitas de maíz para cenar".
    {
      const oRole = originalFood.culinary_role || "meal_dish";
      const cRole = a.culinary_role || "meal_dish";
      const oIsMealLike = oRole === "meal_dish" || oRole === "staple";
      if (oIsMealLike) {
        let roleDemotion = 1;
        if (cRole === "recipe_ingredient") roleDemotion = _demoteRoleRecipeIngredient;
        else if (cRole === "snack")        roleDemotion = _demoteRoleSnack;
        else if (cRole === "dessert")      roleDemotion = _demoteRoleDessert;
        if (roleDemotion < 1) {
          demotion *= roleDemotion;
          if (window.location.search.includes('?debug=1')) {
            console.debug('[role] DEMOTED candidate=\'' + a.name + '\' role=' + cRole + ' factor=' + roleDemotion);
          }
        }
      }
    }

    // R2 EXOTIC: si candidato es exotic (nécora, percebe, pulmón,
    // avestruz, casquería) y origen NO lo es, demote fuerte. Cliente:
    // "no son alternativas normales para una clienta que quiere cambiar
    // pollo un martes por la noche".
    if (a.exotic === true && originalFood.exotic !== true && !isSamePlantClusterSort) {
      demotion *= _demoteExoticMismatch;
      if (window.location.search.includes('?debug=1')) {
        console.debug('[exotic] DEMOTED candidate=\'' + a.name + '\' factor=' + _demoteExoticMismatch);
      }
    }

    // R12 LECHE PREPARADA / SABORIZADA DEMOTE (Hugo brief D):
    // Cuando origen es leche/bebida PURA (sin tokens café/cacao/sabor/
    // infantil) y candidato es leche modificada/preparada (café con leche,
    // cacaolat, leche infantil, merengada, evaporada, condensada, batido
    // saborizado), demote MUY fuerte (×0.05). Aplica independiente de tier
    // (también baja en bloque familia, no solo intercambios).
    {
      const oName = norm(originalFood.name || "");
      const cName = norm(a.name || "");
      const _LECHE_PURA_RE =
        /^(leche|bebida)\s+(de\s+)?(vaca|cabra|oveja|burra|soja|avena|almendra|coco|arroz|avellana|anacardo)|^leche\s+(entera|semidesnatada|desnatada|semi|sin\s+lactosa|uht|fresca|pasteurizada)/i;
      const _LECHE_PREPARADA_RE =
        /\b(cafe?\s*con\s*leche|caf[eé]\s+latte|caf[eé]\s+cortado|caf[eé]\s+capuc|cacaolat|colacao|nesquik|chococao|leche\s+chocolate|leche\s+con\s+cacao|leche\s+con\s+chocolate|leche\s+infantil|leche\s+de\s+continuacion|leche\s+merengada|leche\s+evaporada|leche\s+condensada|batido\s+sabor|batido\s+de\s+(chocolate|fresa|vainilla|cacao|platano)|monster\s+caf[eé]|frappuccino|frappe)\b/i;
      const originIsPureMilk = _LECHE_PURA_RE.test(oName) &&
                                !_LECHE_PREPARADA_RE.test(oName);
      const candIsPrepared = _LECHE_PREPARADA_RE.test(cName);
      if (originIsPureMilk && candIsPrepared) {
        demotion *= 0.05;
        if (window.location.search.includes('?debug=1')) {
          console.debug('[leche-preparada] DEMOTED candidate=\'' + a.name + '\' factor=0.05 (origen leche pura, candidato leche preparada)');
        }
      }
    }

    // R11 RAW vs PROCESSED MEAL_DISH (Hugo mail 16/05/2026 punto 2.A):
    // Cuando origen es ingrediente CRUDO/SECO (avena cruda, arroz crudo,
    // quinoa cruda) — alimento que la clienta tiene en su despensa para
    // cocinar — los candidatos READY-TO-EAT comerciales con meal_slot=
    // desayuno reciben demote fuerte. Hugo: "una mujer que busca avena
    // NO la cambia por Petit Beurre ni Corazón Fundente".
    //
    // Casos disparadores reportados:
    //   Avena cruda 100g → "Cereales Corazón fundente", "P'tit Déj",
    //   "Petit beurre multicereales", "Bolas de cereales".
    //
    // Lógica: origen raw_ingredient=true → candidato ready_to_eat=true
    // procesado = NO intercambio cocina real. Aplica para cereales (grains)
    // sin importar source (también BEDCA "Cereales desayuno base de trigo
    // y arroz", "Arroz hinchado para desayuno", etc).
    if (originalFood.raw_ingredient === true &&
        a.ready_to_eat === true) {
      // Solo aplica si ambos son grains (cereales) — no para legumbres
      // ni proteínas (donde sí queremos pollo/atún comercial).
      if (originalFood.subgroup === "grains" && a.subgroup === "grains") {
        demotion *= 0.20;
        if (window.location.search.includes('?debug=1')) {
          console.debug('[raw-vs-rte] DEMOTED candidate=\'' + a.name + '\' factor=0.20 origin=raw_ingredient candidate=ready_to_eat');
        }
      }
    }

    // R11b TOKEN-BASED CEREAL DESAYUNO (Hugo punto 2.A):
    // Algunos cereales no tienen ready_to_eat marcado pero su nombre los
    // delata como producto desayuno comercial. Demote por tokens cuando
    // origen es grano crudo/seco.
    if ((originalFood.raw_ingredient === true ||
         /^(arroz|avena|quinoa|trigo|cebada|centeno|mijo|bulgur|cuscus)/i.test(originalFood.name || "")) &&
        originalFood.subgroup === "grains" && a.subgroup === "grains") {
      const cName = norm(a.name || "");
      const _CEREAL_DESAYUNO_RE =
        /\b(cereales? desayuno|cereales? para desayunar|arroz hinchado|trigo hinchado|maiz hinchado|muesli|granola|copos de maiz|honey pops|smacks|frosties|choco krispies|all.?bran|fitness|special k|chocapic|nesquik cereal)\b/i;
      if (_CEREAL_DESAYUNO_RE.test(cName)) {
        demotion *= 0.20;
        if (window.location.search.includes('?debug=1')) {
          console.debug('[cereal-desayuno-token] DEMOTED candidate=\'' + a.name + '\' factor=0.20');
        }
      }
    }

    // R10 SWEETS CROSS-CLUSTER (Hugo mail 16/05/2026 punto 3):
    // Dentro de sweets_bakery, alimentos de TIPO distinto no son
    // intercambio: chocolate negro 70% no es turrón ni gusanito ni
    // pudding. Hugo: "chocolate negro: correcto que no fuerce
    // intercambio si no hay alternativa limpia. Mejor 0 que basura".
    //
    // Sub-clusters dentro de sweets_bakery (mismo "tipo" culinario):
    //   - chocolate (chocolate, cacao)
    //   - turron (turrón, turron, mazapán)
    //   - galleta (galleta, biscote, oblea)
    //   - pudin (pudding, pudin, natilla, flan, mousse, cuajada)
    //   - bakery (sobao, magdalena, bizcocho, muffin, donut, brownie, cookie)
    //   - snack (gusanito, palomita, bola, sticks, dianitos)
    //   - barrita (barrita, energetica, proteica)
    //   - cereal (cereales, muesli, granola, copos)
    if (originalFood.subgroup === "sweets_bakery" &&
        a.subgroup === "sweets_bakery") {
      const _SWEETS_CLUSTERS = [
        ["chocolate", "cacao"],
        ["turron", "turrón", "mazapan", "mazapán"],
        ["galleta", "biscote", "oblea", "barquillo"],
        ["pudin", "pudding", "natilla", "flan", "mousse", "cuajada", "panna cotta"],
        ["sobao", "magdalena", "bizcocho", "muffin", "donut", "brownie", "cookie", "croissant", "palmera"],
        ["gusanito", "palomita", "bola de maiz", "stick", "dianitos", "nubes", "chuches", "chuche"],
        ["barrita"],
        ["cereales", "muesli", "granola", "copos", "honey pops", "smacks", "frosties"],
        ["tortita"],
      ];
      const oName = norm(originalFood.name || "");
      const cName = norm(a.name || "");
      function _clusterOf(name) {
        for (let i = 0; i < _SWEETS_CLUSTERS.length; i++) {
          if (_SWEETS_CLUSTERS[i].some((t) => name.includes(t))) return i;
        }
        return -1;
      }
      const oCluster = _clusterOf(oName);
      const cCluster = _clusterOf(cName);
      if (oCluster !== -1 && cCluster !== -1 && oCluster !== cCluster) {
        demotion *= 0.10;
        if (window.location.search.includes('?debug=1')) {
          console.debug('[sweets-cross] DEMOTED candidate=\'' + a.name + '\' factor=0.10 (origin_cluster=' + oCluster + ' cand_cluster=' + cCluster + ')');
        }
      }
    }

    // R9 FAT-CLUSTER NOISE (Hugo mail 16/05/2026 punto 2.C):
    // Cuando origen es grasa real (aceite/aguacate/nueces/aceitunas/tahin),
    // penalizar productos que tienen ALGO de grasa pero NO son grasa pura.
    // Casos vistos por Hugo: foie, paté de sardina, mortadela con aceitunas,
    // ensalada César, hummus con aceitunas, cremas de jamón.
    //
    // Estos suelen ser category=protein o tienen subgroup engañoso —
    // oil_added no los pesca porque oil_added solo aplica a category=fat.
    {
      const _origIsRealFat =
        originalFood.category === "fat" &&
        (_OIL_SUBS.has(originalFood.subgroup) ||
         _DENSE_FAT_SUBS.has(originalFood.subgroup) ||
         _FAT_BRIDGE_NAME_RE.test((originalFood.name || "").toLowerCase()));
      if (_origIsRealFat) {
        const _candName = (a.name || "").toLowerCase();
        // Hugo punto 2.C: penalizar productos que NO son grasa real pura
        // aunque tengan category=fat o aparezcan cerca. Incluye fiambres,
        // patés, foie, ensaladas con dressing, productos preparados.
        const _NON_FAT_NOISE_RE =
          /\b(foie|pat[eé]|mortadela|ensalada cesar|ensalada césar|crema de jam[oó]n|jam[oó]n.*crema|sobrasada|chorizo|salchich[oó]n|salami|fiambre|sushi|tortilla|empanada|croqueta|cesar|caesar|salsa|mayonesa|alioli|aderezo|vinagreta)\b/i;
        if (_NON_FAT_NOISE_RE.test(_candName)) {
          demotion *= 0.20;
          if (window.location.search.includes('?debug=1')) {
            console.debug('[fat-noise] DEMOTED candidate=\'' + a.name + '\' factor=0.20 reason=processed_protein_not_pure_fat');
          }
        }
      }
    }

    // R8 TECHO CALÓRICO OUTLIERS (Hugo mail 16/05/2026 punto 1.A):
    // Si alternativa.kcal > original.kcal * 1.40 → outlier extremo,
    // demote muy fuerte (×0.15). Caso disparador: tofu 73 kcal → mix
    // frutos secos 855 kcal. Una mujer no cambia tofu por nueces puras.
    //
    // Excepción: lean protein cluster (pollo 170 → atún natural 116 → OK
    // ya en su propia regla; pero ternera 250 vs pollo 170 = ratio 1.47
    // y son intercambio válido). Por eso saltamos sameLeanCluster.
    // Escape cluster vegetal: el techo usa kcal per-100g CRUDO, pero tempeh/
    // seitán/soja son proteínas vegetales densas que se escalan en gramos
    // (40g tempeh = 77 kcal ≈ 100g tofu = 73 kcal). Al plato cuadran; el
    // techo per-100g los hundía injustamente. La equivalencia en gramos ya
    // controla las calorías reales del intercambio.
    if (!isSameLeanProteinCluster &&
        !isSamePlantClusterSort &&
        originalFood.calories > 0 && a.calories > 0) {
      const kcalRatio = a.calories / originalFood.calories;
      if (kcalRatio > 1.40) {
        const outlierDemotion = kcalRatio > 2.0 ? 0.10 : 0.20;
        demotion *= outlierDemotion;
        if (window.location.search.includes('?debug=1')) {
          console.debug('[kcal-ceiling] DEMOTED candidate=\'' + a.name + '\' factor=' + outlierDemotion + ' kcal_ratio=' + kcalRatio.toFixed(2) + ' (' + originalFood.calories + ' vs ' + a.calories + ')');
        }
      }
    }

    // R4 DAIRY CROSS-SUBFAMILY: yogur griego ↔ nata / queso curado /
    // leche almendras / leche entera = NO equivalente culinario aunque
    // macros cuadren. Demote fuerte cross-subfamily dentro de dairy.
    if (oDairyFam && cDairyFam && oDairyFam !== cDairyFam) {
      demotion *= _dairyCrossSubfamilyDemotion;
      if (window.location.search.includes('?debug=1')) {
        console.debug('[dairy-cross] DEMOTED candidate=\'' + a.name + '\' (' + cDairyFam + ' vs ' + oDairyFam + ') factor=' + _dairyCrossSubfamilyDemotion);
      }
    }

    // R3 CLINICAL: calorie floor. El cliente lo formuló para alimentos
    // MIXTOS REALES (huevo F=10.5, salmón F=12, yogur griego F=10.2,
    // aguacate F=12, hummus F=8.6) — "si pierde más del 25% de las
    // calorías del origen, no puede ser top match".
    //
    // CRITERIO CLÍNICO (nutricionista 20+ años, validado 16/05/2026):
    // un alimento es "mixto verdadero" cuando su ratio FAT/PROTEIN >= 0.6.
    // Pollo con piel (F/P=9/21=0.43) NO es mixto — es proteína magra
    // con piel-grasa. Pavo es su intercambio NATURAL (Hugo punto 2).
    //
    // Triple gate para activar R3:
    //   - fat >= 10g (sube de 8 — deja fuera pollo con piel 9g)
    //   - kcal >= 100/100g (densidad calórica significativa)
    //   - fat/protein >= 0.6 (proporción de grasa relevante)
    //
    // Además, NUNCA aplicar R3 entre proteínas magras del mismo cluster
    // (meat_lean ↔ meat_lean, fish_white ↔ fish_white) — son intercambios
    // clínicos naturales aunque kcal varíen.
    {
      const oKcal100 = originalFood.calories || 0;
      const oFat100  = originalFood.fat || 0;
      const oProt100 = originalFood.protein || 0;
      const fatProtRatio = oProt100 > 0 ? oFat100 / oProt100 : 0;
      const isMixedOrigin =
        oFat100 >= 10 && oKcal100 >= 100 && fatProtRatio >= 0.6;

      // Hugo brief 16/05/2026 punto 4 — DENSIDAD CALÓRICA POR 100g:
      // Embutidos curados (jamón serrano P=28 F=14.5 kcal=245; cecina
      // P=39 F=9.5 kcal=241) tienen alta densidad calórica. Fiambres
      // cocidos magros (pavo fiambre kcal=105/100g, jamón cocido
      // kcal=113/100g) pierden ~50% densidad — clínicamente no son
      // intercambio aunque la porción equivalente compense en kcal totales.
      //
      // Regla independiente: si origen=processed_meat con kcal>=200 y
      // candidato.kcal_per_100g < origen * 0.60 → demote ×0.30.
      if (originalFood.subgroup === "processed_meat" && oKcal100 >= 200 &&
          a.subgroup === "processed_meat" && a.calories) {
        const densityRatio = a.calories / oKcal100;
        if (densityRatio < 0.60) {
          demotion *= 0.30;
          if (window.location.search.includes('?debug=1')) {
            console.debug('[curado-density] DEMOTED candidate=\'' + a.name + '\' factor=0.30 density_ratio=' + densityRatio.toFixed(2) + ' (' + a.calories + ' vs ' + oKcal100 + ' kcal/100g)');
          }
        }
      }
      // Escape hatch para proteínas magras hermanas (Hugo punto 2)
      const _LEAN_PROTEIN_SUBS = new Set([
        "meat_lean", "meat", "fish_white", "fish_fatty", "eggs",
      ]);
      const sameLeanCluster =
        originalFood.category === "protein" && a.category === "protein" &&
        _LEAN_PROTEIN_SUBS.has(originalFood.subgroup) &&
        _LEAN_PROTEIN_SUBS.has(a.subgroup) &&
        a.exotic !== true;
      if (isMixedOrigin && !sameLeanCluster &&
          originalMacros.calories > 0 && a.macros) {
        const calRatio = a.macros.calories / originalMacros.calories;
        // Hugo mail 16/05/2026 punto 1.C — doble escalón:
        //   <0.75 → penalizar fuerte (visible pero abajo)
        //   <0.60 → sacar del top, mover a bloque secundario (factor agresivo)
        if (calRatio < 0.60) {
          const floorDemotion = Math.max(0.20, calRatio * 0.5);
          demotion *= floorDemotion;
          if (window.location.search.includes('?debug=1')) {
            console.debug('[cal-floor-strict] DEMOTED candidate=\'' + a.name + '\' factor=' + floorDemotion.toFixed(2) + ' cal_ratio=' + calRatio.toFixed(2) + ' (lighter-option)');
          }
        } else if (calRatio < 0.75) {
          const floorDemotion = Math.max(0.55, 0.4 + calRatio * 0.5);
          demotion *= floorDemotion;
          if (window.location.search.includes('?debug=1')) {
            console.debug('[cal-floor] DEMOTED candidate=\'' + a.name + '\' factor=' + floorDemotion.toFixed(2) + ' cal_ratio=' + calRatio.toFixed(2));
          }
        }
      }
    }

    // R4 CLINICAL: absurd quantity. Cliente punto 7: "si para cuadrar hace
    // falta una cantidad que una persona normal no comería, no puede salir
    // arriba." Ej. yogur griego 125g → té con leche 516g, skyr 125g →
    // gelatina yogur 568g, yogur griego → kéfir 350g.
    //
    // Threshold CONTEXTUAL por categoría del origen (cliente listó lácteos /
    // bebidas / postres / snacks / salsas como casos donde x3 ya es absurdo,
    // pero permite x3-5 en hidratos húmedos crudo↔cocido).
    //
    // Excepción explícita: hidratos crudo↔cocido (arroz crudo 60g ≈
    // 250g patata cocida es clínicamente correcto).
    {
      const ratio = a.equivalentAmount > 0 && amount > 0
        ? a.equivalentAmount / amount
        : 1;

      // Threshold por categoría del origen
      const STRICT_CATS = new Set(["dairy", "fat"]);  // lácteos + grasas
      // Postres y salsas detectados por culinary_role (también estrictos)
      const oRole = originalFood.culinary_role || "meal_dish";
      const isStrictContext = STRICT_CATS.has(originalFood.category) ||
                              oRole === "dessert" || oRole === "snack";
      const threshold = isStrictContext ? 2.5 : 3.0;

      if (ratio > threshold) {
        // Hidratos SECOS → HÚMEDOS exception: solo válida cuando origen ES
        // SECO (raw_ingredient=true, ej. arroz crudo) y candidato es cocido
        // (ej. patata cocida). NO aplica cuando ambos son COCIDOS (lentejas
        // cocidas → judías troceadas cocidas: NO tiene sentido 5x).
        //
        // Legumbres en la BD están casi todas cocidas/en conserva → la
        // excepción rara vez aplica para legumes.
        const HYDRATE_SUBS = new Set(["grains", "tubers"]);
        const bothHydratesDry = originalFood.category === "carbs" &&
          a.category === "carbs" &&
          HYDRATE_SUBS.has(originalFood.subgroup) &&
          HYDRATE_SUBS.has(a.subgroup);
        // Solo válido cuando ORIGEN es seco/crudo
        const isLegitDryWet = bothHydratesDry &&
          originalFood.raw_ingredient === true &&
          a.raw_ingredient !== true;

        if (!isLegitDryWet) {
          // Hugo mail 16/05/2026 punto 1.B: ratio >3 manda al fondo.
          // Endurecido: ratio > 4x → ×0.05 (casi-eliminatorio).
          //   strict ratio 2.6 → ×0.45  |  ratio 4 → ×0.10  |  ratio 6+ → ×0.05
          //   normal ratio 3.1 → ×0.60  |  ratio 4   → ×0.25 |  ratio 5+ → ×0.10
          //   ratio 7+ siempre   → ×0.05 (cantidad inviable culinariamente)
          let absurdDemotion;
          if (ratio >= 7) {
            absurdDemotion = 0.05;
          } else if (ratio >= 5) {
            absurdDemotion = isStrictContext ? 0.05 : 0.10;
          } else if (ratio >= 4) {
            absurdDemotion = isStrictContext ? 0.10 : 0.20;
          } else {
            // ratio 2.5-4.0 → demote gradual
            const slope = isStrictContext ? 0.30 : 0.20;
            const floor = isStrictContext ? 0.15 : 0.30;
            absurdDemotion = Math.max(floor, 1 - (ratio - threshold) * slope);
          }
          demotion *= absurdDemotion;
          if (window.location.search.includes('?debug=1')) {
            console.debug('[absurd-qty] DEMOTED candidate=\'' + a.name + '\' factor=' + absurdDemotion.toFixed(2) + ' ratio=' + ratio.toFixed(1) + 'x ctx=' + (isStrictContext ? 'strict' : 'normal'));
          }
        }
      }
    }

    // CLINICAL: processing level. Alimentos más procesados se demoten
    // ligeramente para que simples/básicos aparezcan antes. Usa el campo
    // processing_level de la DB (0-3) o lo infiere del subgroup/nombre.
    {
      const procLevel = a.processing_level != null
        ? a.processing_level
        : inferProcessingLevel(a);
      if (procLevel > 0) {
        const procDemotion = 1 - procLevel * 0.12;  // 1→×0.88, 2→×0.76, 3→×0.64
        demotion *= procDemotion;
        if (window.location.search.includes('?debug=1') && procLevel > 1) {
          console.debug('[proc-level] DEMOTED candidate=\'' + a.name + '\' level=' + procLevel + ' factor=' + procDemotion.toFixed(2));
        }
      }
    }

    return {
      ...a,
      premiumContext: premiumContext.candidate,
      premiumContextReason: premiumContext.reason,
      premiumContextPriority: premiumContext.priority,
      _hybridScore: hybrid,
      _sortScoreBase: hybrid + affinityBonus + provenanceBonus + subgroupBonus + fatBridgeBonus + proteinBridgeBonus + dairyFamilyBonus + culturalPairBonus + plantProteinBonus + carbShapeBonus + proteinFormBonus + vegetableContextBonus + whiteFishCohortBonus,
      _sortScore: (hybrid + affinityBonus + provenanceBonus + subgroupBonus + fatBridgeBonus + proteinBridgeBonus + dairyFamilyBonus + culturalPairBonus + plantProteinBonus + carbShapeBonus + proteinFormBonus + vegetableContextBonus + whiteFishCohortBonus) * demotion,
    };
  });

  // Group by semantic type using the existing tier field:
  //   T2 (different subgroup, same category) → real exchanges — show first, expanded
  //   T1 (same subgroup)                     → same ingredient family — collapsed
  //   T3 (prepared flag)                     → processed/prepared dishes — collapsed last
  //
  // Within each group, sort by _judgeRank (primary, when judge ran) then by
  // _sortScore DESC (secondary / fallback for items outside judge top-50 or
  // when the judge gate was skipped — _judgeRank ?? 9999 guarantees correct
  // behavior on the SKIP path without any special-casing).
  //
  // Defined BEFORE the judge gate so the progressive-UI partial emit can call
  // it with _judgeRank still absent — the `?? 9999` fallback yields a clean
  // math-only ranking. After applyJudgeVerdict() injects _judgeRank, calling
  // byTier again reflects the LLM-corrected order.
  const byTier = (t) => {
    const sorted = withHybrid
      .filter(a => a.tier === t)
      .sort((a, b) => {
        const ra = a._judgeRank ?? 9999;
        const rb = b._judgeRank ?? 9999;
        if (ra !== rb) return ra - rb;
        return b._sortScore - a._sortScore;
      });

    // "Misma familia" ya es un bloque de formatos/marcas del mismo
    // ingrediente. Aplicarle diversidad vuelve a pisar el score y empuja
    // una segunda avena/leche/huevo detrás de referencias peores.
    if (t === 1) return sorted;

    // Diversidad: primer representante de cada cluster al frente;
    // variantes secundarias al final del mismo tier.
    // clusterIngredientKey() colapsa por primer token + sinónimos.
    const seen = new Set();
    const primary = [];
    const secondary = [];
    for (const food of sorted) {
      const key = clusterIngredientKey(food);
      if (seen.has(key)) {
        secondary.push(food);
      } else {
        seen.add(key);
        primary.push(food);
      }
    }

    // La procedencia ya participa como bonus suave en _sortScore mediante
    // sourceAffinityBonus(). No debe volver a convertirse aquí en una
    // partición dura: hacerlo pisa el ranking clínico y coloca productos
    // mediocres de la misma procedencia delante de opciones simples con un
    // score mayor (especialmente OpenFoodFacts → OpenFoodFacts).
    return [...primary, ...secondary];
  };

  // ── PROGRESSIVE UI: PARTIAL RESULT ────────────────────────────────────────
  // Emit a math-only result NOW so the UI can render immediately while the
  // LLM judge call (2-3 s in cache MISS) runs in the background. The partial
  // result has noMatch=false (we don't know yet) and an _isPartial flag so
  // the caller can show a subtle "refinando..." indicator.
  //
  // byTier() falls back to _sortScore when _judgeRank is absent (via `?? 9999`)
  // so the partial result is already ranked by the math + bulk-label demotions
  // + same-subgroup/fat-bridge bonuses — i.e. the best ranking we can produce
  // without the judge.
  if (typeof opts.onPartialUpdate === "function") {
    try {
      opts.onPartialUpdate({
        intercambios: byTier(2),
        familia:      byTier(1),
        preparados:   byTier(3),
        noMatch:      false,
        _isPartial:   true,
      });
    } catch (e) {
      if (window.location.search.includes('?debug=1')) {
        console.debug('[progressive-ui] onPartialUpdate threw:', e);
      }
    }
  }

  // ── LLM JUDGE GATE ───────────────────────────────────────────────────────────
  // ALWAYS-ON judge en top-N T2 candidates. El cache server-side (TTL 24h
  // db-namespaced en microservicio/judge_cache.py) absorbe el costo de
  // queries repetidas. Primera ejecución por (origin, candidates) llama
  // al LLM una vez; subsiguientes son cache hits gratis.
  //
  // S1-S6 triggers se siguen evaluando como contexto informativo (qué
  // razones disparan) pero NO gatean la llamada — el judge corre siempre.
  //
  // Kill-switch: window.LLM_JUDGE_ENABLED = false → skip entirely.
  // On any error (timeout, 5xx, abort, parse) → no-op, original order preserved.
  let _judgeInsufficientMatches = false;
  {
    const _llmJudgeEnabled = window.LLM_JUDGE_ENABLED !== false;
    const _isDebug         = window.location.search.includes('?debug=1');

    if (!_llmJudgeEnabled) {
      if (_isDebug) console.debug('[llm-judge] SKIP enabled=false');
    } else {
      // Top-N candidatos para el judge. ALWAYS-ON: el LLM corre en TODA
      // búsqueda (cliente lo exigió explícito — "todos tienen que llamar
      // al menos 1 vez"). Si T2 está escaso, complementamos con T1
      // (familia) y T3 (preparados) hasta llegar a un pool mínimo de 5.
      //
      // Aguacate, por ejemplo, puede tener T2 vacío (todos los demás
      // fat-foods caen en T1 por compartir tokens raros en el nombre).
      // En ese caso el judge igual juzga T1/T3 — no se salta.
      const _t2 = withHybrid.filter(a => a.tier === 2)
                            .sort((a, b) => b._sortScore - a._sortScore);
      const _t1 = withHybrid.filter(a => a.tier === 1)
                            .sort((a, b) => b._sortScore - a._sortScore);
      const _t3 = withHybrid.filter(a => a.tier === 3)
                            .sort((a, b) => b._sortScore - a._sortScore);

      let _topJudge;
      if (_t2.length >= 5) {
        // Caso normal: T2 alcanza.
        _topJudge = _t2.slice(0, JUDGE_TOP_N);
      } else {
        // T2 escaso → complementar con T1 + T3 (priorizando T1).
        const combined = [..._t2, ..._t1, ..._t3].slice(0, JUDGE_TOP_N);
        _topJudge = combined;
      }

      if (_topJudge.length === 0) {
        if (_isDebug) console.debug('[llm-judge] SKIP no candidates at all in any tier');
      } else {
        // Evaluamos triggers para informar al LLM por qué se le consulta,
        // pero la llamada es ALWAYS-ON (cache absorbe el costo).
        const _triggered = evaluateJudgeTriggers(originalFood, _topJudge);
        const _reasonsForLog = _triggered.length > 0 ? _triggered : ['always_on'];

        {
          if (_isDebug) {
            console.debug('[llm-judge] ALWAYS-ON judge_pool=' + _topJudge.length + ' (t2=' + _t2.length + ' t1=' + _t1.length + ' t3=' + _t3.length + ') triggers=[' + _reasonsForLog.join(',') + ']');
          }
          const _verdict = await callJudge(originalFood, _topJudge, _reasonsForLog, amount);
          if (_verdict) {
            applyJudgeVerdict(withHybrid, _verdict);
            _judgeInsufficientMatches = _verdict.insufficient_matches === true;
            if (_isDebug) {
              console.debug(
                '[llm-judge] APPLIED cache=' + _verdict.cache +
                ' latency_ms=' + _verdict.latency_ms +
                ' ranked=' + (_verdict.ranked_ids || []).length +
                ' removed=' + (_verdict.removed_ids || []).length +
                ' insufficient_matches=' + _judgeInsufficientMatches
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

  // Final result: byTier now consumes _judgeRank fields injected by
  // applyJudgeVerdict() above, so the ordering reflects LLM correction.
  const intercambios = byTier(2);

  // noMatch: true cuando el judge confirma que hay <3 intercambios
  // culinariamente válidos. El frontend puede mostrar un mensaje honesto
  // ("No encontramos un intercambio equivalente para este alimento")
  // en vez de forzar resultados clínicamente inapropiados.
  const _judgeNoMatch = _judgeInsufficientMatches && intercambios.length < 3;

  // Hugo mail 16/05/2026 punto 3: "chocolate negro: correcto que no
  // fuerce intercambio si no hay alternativa limpia". Threshold
  // automático: si los top 3 intercambios tienen _sortScore < 0.30
  // todos (todo demoteado/basura), forzar noMatch independiente
  // del judge. Aplica a alimentos snack/dessert sin equivalente claro.
  const oRoleForNoMatch = originalFood.culinary_role || "meal_dish";
  const isSnackishOrigin =
    oRoleForNoMatch === "snack" || oRoleForNoMatch === "dessert" ||
    originalFood.subgroup === "sweets_bakery";
  let _thresholdNoMatch = false;
  if (isSnackishOrigin && intercambios.length > 0) {
    const top3 = intercambios.slice(0, 3);
    const allLow = top3.every(a => (a._sortScore || 0) < 0.30);
    if (allLow) {
      _thresholdNoMatch = true;
      if (window.location.search.includes('?debug=1')) {
        console.debug('[no-match-threshold] FORZADO origen=\'' + originalFood.name + '\' top3 sortScore < 0.30 (Hugo punto 3)');
      }
    }
  }

  const noMatch = _judgeNoMatch || _thresholdNoMatch;

  return {
    intercambios,
    familia:   byTier(1),
    preparados: byTier(3),
    noMatch,
  };
}

// ============================================
// TOKEN-AWARE SORT SCORE
// ============================================
// Adjetivos de estado de un alimento canónico: "Arroz, hervido" / "Patata,
// cruda" / "Pasta alimenticia, integral, cruda" / "Avena en copos". Si el
// nombre matchea <query> + alguno → es el alimento canónico, no "X de Y".
const _CANONICAL_STATE_RE =
  /^([a-z]+)\s+(crudo|cruda|hervido|hervida|asado|asada|tostado|tostada|natural|integral|entero|entera|en copos|en grano|molido|molida|hinchado|hinchada|alimenticia|alimenticio|blanco|blanca)\b/;

// ============================================
// SEARCH MODIFIER PENALTY — forma canónica > forma modificada
// ============================================
// Hugo audit (Feedback Elena): el autocomplete elegía formas no canónicas
// como origen (Leche en polvo, Yogur con fresas, yema de huevo, Aceite de
// soja). El cliente busca el alimento simple. Penaliza modificadores SALVO
// que el query los pida explícitamente. Devuelve nº de penalizaciones (más
// alto = peor). Se usa como desempate en searchFoods, antes de sourceBoost.
const _SEARCH_MOD_GROUPS = [
  { re: /\b(en polvo|polvo|deshidratad|desecad|liofiliz|concentrad)\b/, kw: ["polvo", "deshidratado", "deshidratada", "desecado", "desecada", "concentrado", "concentrada"] },
  { re: /\b(yema|clara)s?\b/, kw: ["yema", "yemas", "clara", "claras"] },
  { re: /\bcondensad[ao]\b/, kw: ["condensada", "condensado"] },
  { re: /(con fresa|con frut|con cereal|con galleta|con miel|con nata|con az[uú]car|sabor|aromatiz|edulcorad|chocolate|vainilla|caramelo)/, kw: ["fresa", "frutas", "fruta", "cereales", "sabor", "chocolate", "vainilla", "caramelo", "miel"] },
  { re: /\b(rellen[ao]s?|stuffed|farci)\b/, kw: ["relleno", "rellena", "rellenas", "rellenos", "stuffed"] },
];

function searchModifierPenalty(nameNorm, queryTokens) {
  const nn = nameNorm.replace(/[,;:]/g, " ").replace(/\s+/g, " ");
  const q = (queryTokens || []).join(" ");
  let p = 0;
  for (const g of _SEARCH_MOD_GROUPS) {
    if (g.re.test(nn) && !g.kw.some((k) => q.includes(k))) p += 1;
  }
  return p;
}

function tokenSortScore(nameNorm, queryTokens) {
  // Normalizar puntuación BEDCA ("Arroz, hervido", "Patata, cruda") → espacios
  // para que startsWith(t + " ") matchee igual que "Arroz Hervido".
  // Sin esto, BEDCA materia prima pierde contra productos brand de super.
  const nn = nameNorm.replace(/[,;:]/g, " ").replace(/\s+/g, " ");
  let score = 0;
  const allPresent = queryTokens.every((t) => nn.includes(t));
  if (allPresent) score += 5;
  // Match EXACTO de nombre completo (Hugo Feedback Elena): si el usuario
  // tipea "manzana" y existe el alimento llamado exactamente "Manzana", ese
  // gana sobre "Manzana asada" / "Manzana, cruda" (que reciben bonus canónico
  // por el adjetivo). El nombre desnudo ES la forma más canónica.
  if (nn === queryTokens.join(" ")) score += 4;
  queryTokens.forEach((t) => {
    if (nn.includes(t)) score += 1;
    if (nn.startsWith(t + " ") || nn === t) score += 2;
  });
  if (queryTokens.some((t) => nn.startsWith(t))) score += 3;
  // Bonus canónico: <query> + adjetivo-de-estado gana sobre "<query> de X".
  // Ej: "pasta alimenticia cruda" > "pasta de sésamo" ; "pan tostado" > "pan rallado".
  if (queryTokens.length === 1 && _CANONICAL_STATE_RE.test(nn)) {
    const m = nn.match(_CANONICAL_STATE_RE);
    if (m && m[1] === queryTokens[0]) score += 2;
  }
  return score;
}

// ============================================
// SOURCE BOOST — preferir BEDCA > supermercados ES > OFF verificado en España
// Solo se usa como desempate cuando dos alimentos tienen el mismo
// tokenSortScore. Nunca anula la relevancia textual.
// ============================================
function sourceBoost(food) {
  switch (sourceMarketClass(food)) {
    case "generic": return 100;
    case "core_es_super": return 80;
    case "other_es_super": return 65;
    case "verified_core_off": return 50;
    case "verified_es_off": return 35;
    default: return 0;
  }
}

// En búsquedas genéricas cortas ("pollo", "mozzarella", "leche
// semidesnatada"), una referencia BEDCA que contiene todos los términos debe
// abrir el listado antes que una marca cuyo nombre coincida de forma literal.
// No aplica a consultas de marca ni a frases largas y respeta modificadores
// solicitados por la usuaria.
function canonicalSpanishGenericPriority(food, queryTokens) {
  if (
    !Array.isArray(queryTokens) ||
    queryTokens.length === 0 ||
    queryTokens.length > 2 ||
    sourceMarketClass(food) !== "generic"
  ) {
    return 0;
  }
  const name = norm(food.name || "");
  if (!queryTokens.every((token) => name.includes(token))) return 0;
  if (searchModifierPenalty(name, queryTokens) !== 0) return 0;
  return 1;
}

// ============================================
// SEARCH FOODS (local database)
// ============================================
function getLocalSearchResults(query) {
  const qn = norm(query);

  // PASO 1: Buscar en database local
  // Excluimos "hidden" (duplicados nutricionales) para no inflar el listado
  // de búsqueda con 12 versiones del mismo arroz/atún/pollo.
  const localResults = foodsDatabase
    .filter((food) => matchesFood(food, query))
    .filter((food) => !(food.flags || []).includes("hidden"))
    .filter((food) => !isFoodQuarantined(food))
    .filter((food) => isMarketEligibleFood(food))
    .filter(
      (food) =>
        typeof window.isPremiumExchangeSearchable !== "function" ||
        window.isPremiumExchangeSearchable(food),
    )
    .sort((a, b) => {
      const tokens = tokenize(query);
      const canonicalA = canonicalSpanishGenericPriority(a, tokens);
      const canonicalB = canonicalSpanishGenericPriority(b, tokens);
      if (canonicalA !== canonicalB) return canonicalB - canonicalA;
      const scoreA = tokenSortScore(norm(a.name || ""), tokens);
      const scoreB = tokenSortScore(norm(b.name || ""), tokens);
      if (scoreA !== scoreB) return scoreB - scoreA;
      // 1er desempate: forma canónica > forma modificada (Hugo Feedback Elena).
      // El cliente busca "leche semidesnatada" y quiere LECHE LÍQUIDA, no "en
      // polvo"; "huevo" → huevo entero, no "yema"; "yogur" → natural, no "con
      // fresas". Penaliza polvo/deshidratado/condensado/yema-clara/saborizado
      // SALVO que el propio query lo pida.
      const penA = searchModifierPenalty(norm(a.name || ""), tokens);
      const penB = searchModifierPenalty(norm(b.name || ""), tokens);
      if (penA !== penB) return penA - penB;
      // 2do desempate: BEDCA, supermercados españoles y OFF España verificado.
      const boostA = sourceBoost(a);
      const boostB = sourceBoost(b);
      if (boostA !== boostB) return boostB - boostA;
      // 3er desempate: NO exótico > exótico (Hugo Feedback Elena). "huevo" →
      // huevo de gallina, no de pato/codorniz; "leche" → vaca, no de búfala.
      const exA = a.exotic === true ? 1 : 0;
      const exB = b.exotic === true ? 1 : 0;
      if (exA !== exB) return exA - exB;
      // 4to desempate: frecuencia de consumo en España (habitual > ocasional >
      // raro). "aceite" → oliva (habitual), no soja (raro); "arroz" → blanco/
      // integral, no salvaje.
      const _freqRank = (f) => {
        const fr = (f.frequency || "").toLowerCase();
        if (fr === "habitual") return 0;
        if (fr === "ocasional") return 1;
        if (fr === "raro") return 2;
        return 1; // sin dato: neutro
      };
      const frA = _freqRank(a);
      const frB = _freqRank(b);
      if (frA !== frB) return frA - frB;
      // 5to desempate: materia prima (raw_ingredient:true) > preparado.
      // Cuando el usuario busca "arroz" / "avena" / "pasta", quiere el grano
      // base, no "Arroz con leche" ni "Avena crunchy" ni "Pasta de fruta".
      const rawA = a.raw_ingredient === true ? 1 : 0;
      const rawB = b.raw_ingredient === true ? 1 : 0;
      if (rawA !== rawB) return rawB - rawA;
      // 3er desempate: nombre más corto primero
      return (a.name || "").length - (b.name || "").length;
    });

  return localResults;
}

async function searchFoods(query) {
  const localResults = getLocalSearchResults(query);
  // Mostrar resultados locales (única fuente — FatSecret eliminado).
  lastSearchResults = localResults;
  lastQuery = query;
  renderAutocomplete(lastSearchResults, lastQuery);
}
