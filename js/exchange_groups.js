/**
 * exchange_groups.js
 *
 * Clinical subgroup compatibility filter for food exchanges.
 * Loaded as a plain <script> BEFORE js/algorithm.js.
 * Attaches three globals to window: ALLOWED_SUBGROUPS, isCompatibleSubgroup,
 * assertSubgroupConsistency.
 *
 * Kill-switch: set window.DISABLE_SUBGROUP_FILTER = true in DevTools
 * to bypass subgroup filtering without redeploy.
 *
 * Sources: Russolillo G. & Marquez-Sandoval F. "Tabla de Raciones" (SEDCA/Fisterra).
 *          Fisterra.com "Intercambios de alimentos en diabetes".
 */
(function (global) {
  'use strict';

  // ── Drift tracker ──────────────────────────────────────────────────────────
  // Initialized before any function runs so callers never need a null-guard.
  global.__exchangeGroupsDrift = {
    unknownOrigin:     new Set(),
    unknownCandidate:  new Set(),
    unknownAllowedKey: new Set(),
  };

  // ── Logger ──────────────────────────────────────────────────────────────────
  // Full implementation per spec REQ-C2.
  // T4.3 note: Logger is defined before ALLOWED_SUBGROUPS so isCompatibleSubgroup
  // can reference it safely.
  var Logger = (function () {
    var _seenDrift = new Set();
    var _debug = (
      typeof window !== 'undefined' &&
      typeof window.location !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debug') === '1'
    );

    return {
      /**
       * Emit one console.warn per unique (type::value) pair per page load.
       * Format: [exchange-groups] DRIFT: subgroup '<value>' present in DB but missing from ALLOWED_SUBGROUPS map
       * @param {string} type  - 'unknown_origin_subgroup' | 'unknown_candidate_subgroup' | 'db_subgroup_not_in_map'
       * @param {string} value - offending subgroup string
       */
      logDrift: function (type, value) {
        var key = type + '::' + value;
        if (_seenDrift.has(key)) return;
        _seenDrift.add(key);
        console.warn(
          '[exchange-groups] DRIFT: subgroup \'' + value +
          '\' present in DB but missing from ALLOWED_SUBGROUPS map — type: ' + type
        );
      },

      /**
       * Per-candidate reject log. Only fires when ?debug=1 is in the URL.
       * @param {Object} candidate - food object rejected
       * @param {string} reason    - reason string
       */
      logFilterReject: function (candidate, reason) {
        if (!_debug) return;
        console.debug(
          '[exchange-groups] reject:', candidate && candidate.name,
          '| candidate.subgroup:', candidate && candidate.subgroup,
          '| reason:', reason
        );
      },
    };
  })();

  // ── ALLOWED_SUBGROUPS ───────────────────────────────────────────────────────
  // Full map per spec REQ-B.
  //
  // Reading guide:
  //   - Each key is an ORIGIN subgroup (the food selected by the user).
  //   - Each value array lists the PERMITTED TARGET subgroups for an exchange.
  //   - Tier 1 (T1, "STRICT") and Tier 2 (T2, "ADVANCED") exchanges are merged
  //     into the same array. The algorithm handles ranking; the map handles eligibility.
  //   - Keys use 'grains' (NOT 'bread_pasta'): spec REQ-A is authoritative;
  //     'bread_pasta' from the design draft is intentionally absent.
  //
  // Ref: Russolillo G., Fisterra.com — "Tabla de raciones de intercambio de alimentos"
  //      Cada fila aprobable por la nutricionista sin leer código.

  var ALLOWED_SUBGROUPS = {

    // ── PROTEINAS ─────────────────────────────────────────────────────────────
    // Fuente: Fisterra/Russolillo tablas de intercambio — 100–125 g carne/pescado magro
    //         = 2 huevos medianos = 60 g legumbre seca.

    meat_lean: [
      // T1 STRICT — mismo perfil proteico magro por tablas españolas
      'meat_lean',
      'fish_white',
      'fish_fatty',
      'eggs',
      'legumes',
      'plant_protein',
      // T2 ADVANCED — mismo grupo cárnico, mayor aporte graso (intercambio ocasional admisible)
      'meat_fatty',
    ],
    // Russolillo: carne magra = equivalente proteico estándar por excelencia

    meat_fatty: [
      // T1 STRICT — grupo cárnico con grasa; equivalencia por proteína bruta
      'meat_fatty',
      'meat_lean',
      'fish_fatty',
      'eggs',
      // T2 ADVANCED — diferencia en perfil graso justifica clasificar como avanzado
      'fish_white',
      'legumes',
      'plant_protein',
    ],

    viscera: [
      'viscera',
      // Russolillo: perfil único (hierro hem, colesterol, vitamina A) — no intercambiable
      // con otros grupos proteicos sin supervisión clínica.
    ],
    // Solo dentro de su grupo; perfil nutricional y riesgo cardiovascular distintos.

    processed_meat: [
      'processed_meat',
      // Alto sodio y grasa saturada hacen inviable el intercambio libre con otros grupos.
      // Fisterra: consumo ocasional, no sustituto de proteína magra.
    ],
    // Solo dentro de su grupo; nunca sustituto de carne magra o pescado.

    fish_white: [
      // T1 STRICT — intercambios estándar por tablas españolas (Fisterra)
      'fish_white',
      'fish_fatty',
      'meat_lean',
      'eggs',
      'legumes',
      'plant_protein',
    ],
    // Russolillo: 125–150 g pescado blanco = 1 ración proteína estándar.

    fish_fatty: [
      // T1 STRICT — intercambio estándar; diferencia omega-3 no bloquea sustitución
      'fish_fatty',
      'fish_white',
      'meat_lean',
      'eggs',
    ],
    // Fisterra: pescado azul — 100–125 g. Omega-3 es valor añadido, no restricción.

    eggs: [
      // T1 STRICT — 2 huevos = 1 ración proteína estándar (Fisterra)
      'eggs',
      'meat_lean',
      'fish_white',
      'fish_fatty',
      'legumes',
      'plant_protein',
    ],

    // PENDIENTE VALIDACIÓN NUTRICIONISTA: legumes clasificado bajo proteínas (uso clínico
    // más común en España, Fisterra/Russolillo). Alternativa pendiente de revisión:
    // splitear a carbs.legumes_dry si la nutricionista considera que el contexto de uso
    // es principalmente energético. Ver spec REQ-A branch:protein.
    legumes: [
      // T1 STRICT — fuente vegetal mixta proteico-HC
      'legumes',
      'plant_protein',
      // T2 ADVANCED — perfil mixto (proteína + HC) hace que sustituir carne directamente sea avanzado
      'meat_lean',
      'fish_white',
      'eggs',
    ],

    plant_protein: [
      // T1 STRICT — equivalencia proteica vegetal (Russolillo: tofu/seitán = proteína estándar)
      'plant_protein',
      'legumes',
      'meat_lean',
      'fish_white',
      'eggs',
    ],
    // Decisión D2 (bloqueada): plant_protein es subgrupo nuevo introducido en Fase 1.

    // ── LACTEOS ───────────────────────────────────────────────────────────────
    // Fuente: Fisterra — 1 ración láctea = 200–250 ml leche / 125 g yogur / 30–40 g queso curado.

    whole_dairy: [
      // T1 STRICT — mismo lácteo, diferente contenido graso
      'whole_dairy',
      'low_fat_dairy',
      // T2 ADVANCED — diferente textura/proceso pero misma familia láctea
      'high_protein_dairy',
      'fresh_cheese',
    ],

    low_fat_dairy: [
      // T1 STRICT — intercambio directo dentro de lácteos fluidos
      'low_fat_dairy',
      'whole_dairy',
      // T2 ADVANCED — misma base láctea, concentración proteica diferente
      'high_protein_dairy',
      'fresh_cheese',
    ],

    high_protein_dairy: [
      // T1 STRICT — intercambio dentro de la familia láctea; base nutricional compatible
      // Este subgrupo ya estaba bien etiquetado en BD (Skyr, Yopro, quark).
      'high_protein_dairy',
      'low_fat_dairy',
      'whole_dairy',
      'fresh_cheese',
    ],
    // Clave para AC-3 (Skyr -> Yopro): cross-category se maneja por isCompatibleCategory;
    // dentro de dairy, high_protein_dairy intercambia con todos los lácteos fluidos.

    aged_cheese: [
      // T1 STRICT — alto contenido graso y sal; intercambio solo dentro del subgrupo
      'aged_cheese',
      // T2 ADVANCED — diferencia significativa en grasa y sal
      'fresh_cheese',
    ],
    // Russolillo: 30–40 g queso curado = 1 ración láctea. No equivalente a lácteo fluido.

    fresh_cheese: [
      // T1 STRICT — baja grasa, alta humedad; equivalencia proteica razonable
      'fresh_cheese',
      'high_protein_dairy',
      // T2 ADVANCED — diferente textura pero base láctea compatible
      'whole_dairy',
      'low_fat_dairy',
    ],

    // ── GRASAS ────────────────────────────────────────────────────────────────
    // Fuente: Russolillo — 1 ración grasa = 10 ml aceite / 25–30 g frutos secos.

    olive_oil: [
      // T1 STRICT — intercambio estándar entre aceites vegetales
      'olive_oil',
      'other_oils',
      // T2 ADVANCED — perfil monoinsaturado similar, pero matriz sólida vs líquida
      'avocado',
    ],
    // Russolillo: 10 ml aceite = 1 ración de grasa. AOVE es referencia en tablas españolas.

    other_oils: [
      // T1 STRICT — intercambio entre aceites vegetales
      'other_oils',
      'olive_oil',
    ],

    nuts_seeds: [
      // T1 STRICT — frutos secos y semillas permanecen dentro de su subgrupo
      // Distinto perfil de uso culinario e IG respecto a aceites.
      'nuts_seeds',
    ],
    // Russolillo: 25–30 g frutos secos = 1 ración grasa. No equivale a aceite en contexto culinario.

    butter_margarine: [
      // T1 STRICT — grasa saturada sólida; no intercambiable con aceites sin supervisión
      'butter_margarine',
    ],
    // Fisterra: mantequilla/margarina — uso limitado; perfil de grasa saturada diferente.

    avocado: [
      // T2 ADVANCED — base grasa monoinsaturada compatible; diferente densidad y contexto culinario
      'avocado',
      'olive_oil',
      'other_oils',
    ],
    // Russolillo: aguacate = grasa monoinsaturada en matriz vegetal. 50–60 g = 1 ración.

    // ── HIDRATOS DE CARBONO ───────────────────────────────────────────────────
    // Fuente: Russolillo — 60 g pan = 60 g pasta cruda = 60 g arroz crudo = 200 g patata cocida.
    //
    // NOTA ARQUITECTÓNICA: 'grains' es la única clave canónica para cereales/pan/pasta/arroz.
    // El borrador del design usó 'bread_pasta' como clave hermana, pero la spec REQ-A
    // no la define — solo 'grains'. La spec prevalece sobre el design draft (T1.4, T3.1).

    grains: [
      // T1 STRICT — intercambio directo entre cereales y derivados
      'grains',
      // T2 ADVANCED — mismo IG aproximado, diferente densidad nutricional
      // Russolillo: 60 g arroz crudo ≈ 200 g patata cocida
      'tubers',
    ],

    tubers: [
      // T1 STRICT — intercambio directo entre tubérculos
      'tubers',
      // T2 ADVANCED — T2 inverso (misma justificación Russolillo)
      'grains',
    ],

    sweets_bakery: [
      // T1 STRICT — solo dentro de su subgrupo
      'sweets_bakery',
      // No intercambiable con cereales complejos por perfil glucémico.
      // Fisterra: bollería/dulces no tienen ración de referencia clínica estándar.
    ],

    // ── FRUTAS (existentes — sin cambios requeridos) ─────────────────────────
    // Russolillo: 100–150 g fruta fresca = 1 ración.

    fruit: [
      // T1 STRICT — intercambio libre dentro de fruta fresca
      'fruit',
      'tropical',
      'frutos_bosque',
    ],

    tropical: [
      // T1 STRICT — frutas tropicales intercambiables con fruta estándar
      'tropical',
      'fruit',
    ],

    frutos_bosque: [
      // T1 STRICT — bajas en azúcar; intercambiables con fruta estándar
      'frutos_bosque',
      'fruit',
    ],

    // ── VERDURAS (existentes — sin cambios requeridos) ────────────────────────
    // Fisterra/Russolillo: verduras de libre intercambio por ración equivalente.
    // Todos los subgrupos de verdura se intercambian entre sí (libre intercambio).

    leafy: [
      'leafy', 'cruciferous', 'allium', 'root_veg', 'stalk_veg', 'fruiting_veg', 'other_veg',
    ],

    cruciferous: [
      'leafy', 'cruciferous', 'allium', 'root_veg', 'stalk_veg', 'fruiting_veg', 'other_veg',
    ],

    allium: [
      'leafy', 'cruciferous', 'allium', 'root_veg', 'stalk_veg', 'fruiting_veg', 'other_veg',
    ],

    root_veg: [
      'leafy', 'cruciferous', 'allium', 'root_veg', 'stalk_veg', 'fruiting_veg', 'other_veg',
    ],

    stalk_veg: [
      'leafy', 'cruciferous', 'allium', 'root_veg', 'stalk_veg', 'fruiting_veg', 'other_veg',
    ],

    fruiting_veg: [
      'leafy', 'cruciferous', 'allium', 'root_veg', 'stalk_veg', 'fruiting_veg', 'other_veg',
    ],

    other_veg: [
      'leafy', 'cruciferous', 'allium', 'root_veg', 'stalk_veg', 'fruiting_veg', 'other_veg',
    ],

  };
  // Key count: 12 protein + 5 dairy + 5 fat + 3 carbs + 3 fruit + 7 veg = 35 keys
  // (verify: Object.keys(ALLOWED_SUBGROUPS).length === 35)

  // ── Clinical category gate ──────────────────────────────────────────────────
  // Only categories with a defined clinical subgroup taxonomy are filtered.
  // For vegetables, fruits, other, and postres_proteicos the subgroup filter
  // is bypassed — their subgroups are geographic/botanical, not clinical
  // exchange categories. postres_proteicos is handled by the cross-category
  // bridge in isCompatibleCategory (Skyr <-> Yopro) — double-filtering it
  // would cause false negatives.
  var CLINICAL_CATEGORIES = new Set(['protein', 'carbs', 'fat', 'dairy']);

  // ── Fallback logger deduplication ──────────────────────────────────────────
  // Separate Set from the drift logger so the same food ID doesn't spam.
  var __fallbackLoggedIds = new Set();

  // ── isCompatibleSubgroup ────────────────────────────────────────────────────
  // Full implementation per spec REQ-C1 + user decisions.
  //
  // Kill-switch: window.DISABLE_SUBGROUP_FILTER = true bypasses the entire
  // function on every call. This is a RUNTIME check — do NOT move it to
  // init time. The nutritionist or developer can type this in DevTools console
  // and the next calculateAlternatives call will skip filtering immediately,
  // without any page reload or rebuild.
  //
  // D1 (locked): candidate.subgroup=null + original.subgroup set -> return false.
  // Conservative: showing an unlabeled food as a clinical exchange is dangerous.
  //
  // Category gate (Guardrail #1): only apply on clinical categories.
  // Vegetables and fruits use geographic/botanical subgroups — applying the
  // strict ALLOWED_SUBGROUPS filter there would over-restrict (e.g. blocking
  // leafy <-> root_veg swaps that are clinically fine).
  //
  // @param {Object} candidate - food being tested as an exchange option
  // @param {Object} original  - the origin food selected by the nutritionist
  // @returns {boolean}
  function isCompatibleSubgroup(candidate, original) {
    // Kill-switch: runtime check on every call — intentional, see comment above.
    if (window.DISABLE_SUBGROUP_FILTER === true) return true;

    // Category gate: only filter clinical categories.
    if (!CLINICAL_CATEGORIES.has(original.category)) return true;

    var orig = original && original.subgroup;

    // REQ-C1 rule 1: null/undefined/""/? origin subgroup -> no-op, allow.
    // Guardrail #2: MUST log via deduped logger (data quality signal).
    if (orig == null || orig === '' || orig === '?') {
      var foodId = original && (original.id || original.name);
      if (foodId && !__fallbackLoggedIds.has(foodId)) {
        __fallbackLoggedIds.add(foodId);
        console.warn(
          '[exchange-groups] FALLBACK: original food \'' + (original.name || '?') +
          '\' (id=' + (original.id || '?') + ') has no subgroup; subgroup filter skipped'
        );
      }
      return true;
    }

    // REQ-C1 rule 2: "other" catch-all -> treat as null, no-op.
    if (orig === 'other') return true;

    // REQ-C1 rule 3: origin subgroup is set but NOT a key in ALLOWED_SUBGROUPS.
    // Fail-open: never silently drop everything. Log the drift.
    var allowed = ALLOWED_SUBGROUPS[orig];
    if (!allowed) {
      Logger.logDrift('unknown_origin_subgroup', orig);
      global.__exchangeGroupsDrift.unknownOrigin.add(orig);
      return true;
    }

    var cand = candidate && candidate.subgroup;

    // REQ-C1 rule 4 (D1): candidate subgroup is null/undefined/empty
    // AND origin subgroup is set -> return false (conservative).
    if (cand == null || cand === '' || cand === '?') {
      Logger.logDrift('unknown_candidate_subgroup', String(cand));
      global.__exchangeGroupsDrift.unknownCandidate.add(String(cand));
      Logger.logFilterReject(candidate, 'candidate_null_subgroup');
      return false;
    }

    // REQ-C1 rule 5: candidate subgroup "other" when origin is set -> exclude.
    if (cand === 'other') {
      Logger.logFilterReject(candidate, 'candidate_other_subgroup');
      return false;
    }

    // REQ-C1 rule 6 + 7: check the allow-list.
    var result = allowed.indexOf(cand) !== -1;
    if (!result) {
      Logger.logFilterReject(candidate, 'subgroup_not_in_allowed_list');
    }
    return result;
  }

  // ── assertSubgroupConsistency ───────────────────────────────────────────────
  // REQ-C3: load-time drift detection.
  // Collects all unique subgroup values in the DB, cross-references against
  // ALLOWED_SUBGROUPS keys and values (flattened), and warns once per unknown.
  // MUST NOT throw under any input.
  //
  // @param {Array} foodsDatabase - the full foods array
  function assertSubgroupConsistency(foodsDatabase) {
    try {
      if (!Array.isArray(foodsDatabase)) return;

      // Collect all unique non-null, non-"?", non-"other" subgroups in the DB.
      var seenInDb = new Set();
      for (var i = 0; i < foodsDatabase.length; i++) {
        var f = foodsDatabase[i];
        if (f && f.subgroup && f.subgroup !== '?' && f.subgroup !== 'other') {
          seenInDb.add(f.subgroup);
        }
      }

      // Build the known-subgroups universe: all keys + all values (flattened).
      var known = new Set(Object.keys(ALLOWED_SUBGROUPS));
      var keys = Object.keys(ALLOWED_SUBGROUPS);
      for (var k = 0; k < keys.length; k++) {
        var vals = ALLOWED_SUBGROUPS[keys[k]];
        for (var v = 0; v < vals.length; v++) {
          known.add(vals[v]);
        }
      }

      // Warn once per unknown subgroup.
      seenInDb.forEach(function (sg) {
        if (!known.has(sg)) {
          Logger.logDrift('db_subgroup_not_in_map', sg);
          global.__exchangeGroupsDrift.unknownAllowedKey.add(sg);
        }
      });
    } catch (e) {
      // Never throw — this is a diagnostic tool, not a gate.
      console.warn('[exchange-groups] assertSubgroupConsistency error (non-fatal):', e);
    }
  }

  // ── Lazy init flag ──────────────────────────────────────────────────────────
  // Used by algorithm.js to run assertSubgroupConsistency exactly once.
  var _consistencyChecked = false;

  // Called from calculateAlternatives on first invocation.
  // Idempotent: safe to call multiple times, only runs once per page load.
  function initExchangeGroupsOnce(db) {
    if (_consistencyChecked) return;
    _consistencyChecked = true;
    assertSubgroupConsistency(db);
  }

  // ── Exports ─────────────────────────────────────────────────────────────────
  global.ALLOWED_SUBGROUPS          = ALLOWED_SUBGROUPS;
  global.isCompatibleSubgroup       = isCompatibleSubgroup;
  global.assertSubgroupConsistency  = assertSubgroupConsistency;
  global.initExchangeGroupsOnce     = initExchangeGroupsOnce;
  // Expose Logger for algorithm.js filter-reject hook (Phase 4)
  global.__egLogger                 = Logger;

})(window);
