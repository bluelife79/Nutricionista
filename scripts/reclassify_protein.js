#!/usr/bin/env node
// Clasificador heurístico determinístico para category=protein.
// NO modifica BD. Produce propuesta auditable.
//
// Flag clean_protein:
//   true  = proteína fresca/sin procesar (cruda/plancha/asada/cocida/hervida/
//           horneada/vapor/parrilla/marinada-fresca/ahumada-ligera).
//   false = procesada/transformada: fritos, rebozados, empanados, nuggets,
//           milanesas, croquetas, tempura, palitos, fingers, salchichas,
//           hamburguesas preparadas, surimi, embutido curado, patés, foie,
//           snacks brand (Iberitos, Big Pavo, Wieners), pestos, conservas
//           con aceite/escabeche, aceitunas-rellenas-de-X.

const fs = require("fs");
const path = require("path");

const DB = path.join(__dirname, "..", "database.json");
const db = JSON.parse(fs.readFileSync(DB, "utf8"));
const arr = Array.isArray(db) ? db : db.foods || [];
const items = arr.filter((f) => f.category === "protein");

const N = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’“”'`]/g, "");

const RULES = [
  // ── NOISE: procesado, fritos, rebozados, embutidos, snacks, conservas ──

  {
    rule: "noise_fried_breaded",
    re: /(\bfrit(o|a|os|as)\b|rebozad|empanad|empan\b|nugget|milanesa|croqueta|tempura|palitos? (de )?(pesca|merluza|cangrej|pollo|jamon)|fingers? (de )?(pesca|pollo)|fishstick|fish ?stick|fritter|albondiga.*frit|pollo .*horno (preparado|listo)|breaded|crujient(e|es) (de )?(pollo|pesca))/,
    to: { category: "protein", subgroup: null, clean_protein: false },
  },
  {
    rule: "noise_processed_meat_brand",
    re: /(\bwieners?\b|big pavo|iberitos|salchich|frankfurt|hot ?dog|salami|mortadel|chorizo|jamon (serrano|curado|iber|york|cocido)|jamón (serrano|curado|iber|york|cocido)|fiambre|sobrasad|sobrassad|fuet|longaniz|butifarr|morcill|cecina|cabeza de cerdo|bacon|panceta(?! cruda)|tocino|lardo|chicharron|salchichon|chichon|copa|lomo embuchad|york|cordon ?bleu)/,
    to: { category: "protein", subgroup: "processed_meat", clean_protein: false },
  },
  {
    rule: "noise_processed_spread",
    re: /(\bpate\b|paté|\bpate de\b|foie|terrina|rillette|crema para untar|crema de jamon|crema de jamón|crema de pollo|pesto de (atun|atún|pollo|jamon)|surimi|kani|aceitunas? rellena|aceituna rellena|burger meat\b|preparado de carne|preparado para|preparado mexicano|hamburgues(a|as) preparad|kebab preparado|carne picada (mixta|para|para hamburgues|para albondig))/,
    to: { category: "protein", subgroup: null, clean_protein: false },
  },
  {
    rule: "noise_canned_oily",
    re: /(en aceite (de oliva|de girasol|vegetal|s\/e)|en a leite|en aceite$|en escabech|enlatad(o|a).*aceite|conserva.*aceite|tuna in oil|migas de (atun|atún)|atun (claro )?(en )?aceite|atun ahumado en aceite)/,
    to: { category: "protein", subgroup: null, clean_protein: false },
  },
  // Salazón/curado intenso (no incluir marinada/adobado: son técnicas frescas).
  {
    rule: "noise_cured_salted",
    re: /(\bsalaz(o|on|ón)|bacalao salad(o|a)|arenque salad|anchoa salad|anchoa en salaz|salado fuerte|curado seco|cecina\b|cur(o|a|os|as)? (con sal|en salaz))/,
    to: { category: "protein", subgroup: null, clean_protein: false },
  },
  {
    rule: "noise_prepared_dish",
    re: /(\bpizza|empanada (de|con)|lasaña|lasagna|canelones|ravioli|paella preparada|risotto preparado|sushi preparado|nuggets? (de )?(pollo|pesca)|hamburgues(a|as) (de )?(pollo|ternera|vacuno)(?!.*cruda)|tortilla preparada|ensaladill|preparado vegetal|barbecue|teriyaki listo|en salsa$|con salsa)/,
    to: { category: "protein", subgroup: null, clean_protein: false },
  },

  // ── CLEAN: proteína fresca por estado de cocción explícito ──
  // Las reglas siguientes confirman clean para items que MENCIONAN un método
  // de cocción limpio o estado crudo. Items que no matchean ninguna regla
  // residual reciben el default por subgrupo en el apply.
  {
    rule: "clean_fresh_cooking",
    re: /(\bcrud(o|a|os|as)\b|\bplancha\b|asad(o|a|os|as)\b|\bparrilla\b|al vapor|\bhervid(o|a|os|as)\b|\bcocid(o|a|os|as)\b|\bhorne(a|ad)|al horno|a la sal|en su (jugo|salsa propia)|en agua\b|al natural\b|natural$|\bfresc(o|a|os|as)\b|congelad(o|a|os|as) (?!.*frit)|^pavo$|^pollo$|^salmon$|^salmón$|^atun$|^atún$|^huevo$)/,
    to: { category: "protein", subgroup: null, clean_protein: true },
  },
];

const proposed = [];
const residual = [];

for (const f of items) {
  const n = N(f.name);
  let matched = null;
  for (const r of RULES) {
    if (r.re && r.re.test(n)) { matched = r; break; }
  }
  if (!matched) { residual.push(f); continue; }
  // Preservar subgroup actual si la regla dice subgroup:null
  const to = { ...matched.to };
  if (to.subgroup === null) to.subgroup = f.subgroup;
  proposed.push({
    id: f.id,
    name: f.name,
    kcal: f.calories,
    macros: { P: f.protein, C: f.carbs, F: f.fat },
    from: { category: f.category, subgroup: f.subgroup },
    to,
    rule: matched.rule,
  });
}

const byRule = {};
for (const p of proposed) (byRule[p.rule] = byRule[p.rule] || []).push(p);

const order = [
  "clean_fresh_cooking",
  "noise_fried_breaded", "noise_processed_meat_brand", "noise_processed_spread",
  "noise_canned_oily", "noise_marinated_salty", "noise_prepared_dish",
];

console.log(`\n=== PROPUESTA protein (${items.length}) ===`);
for (const rule of order) {
  const g = byRule[rule];
  if (!g || !g.length) continue;
  const cp = g[0].to.clean_protein ? "clean ✅" : "NOISE ⛔";
  console.log(`\n── ${rule}  [${cp}]  (${g.length})`);
  g.slice(0, 8).forEach((p) => console.log(`   • ${p.name}  [k:${p.kcal} P:${p.macros.P}]`));
  if (g.length > 8) console.log(`   ... (+${g.length - 8} más)`);
}

console.log(`\n=== RESIDUAL (${residual.length}) — manejados por default subgroup en apply ===`);
const resBySub = {};
for (const f of residual) (resBySub[f.subgroup] = (resBySub[f.subgroup] || 0) + 1);
for (const [k, v] of Object.entries(resBySub).sort((a, b) => b[1] - a[1])) console.log(`   ${k}: ${v}`);

const cleanN = proposed.filter((p) => p.to.clean_protein === true).length;
const noiseN = proposed.filter((p) => p.to.clean_protein === false).length;
console.log(`\n=== RESUMEN ===\n  clean: ${cleanN}\n  noise: ${noiseN}\n  residual (default subgroup): ${residual.length}\n  TOTAL: ${items.length}`);

const out = path.join(__dirname, "reclassify_protein.proposed.json");
fs.writeFileSync(out, JSON.stringify({ proposed, residual: residual.map((f) => ({ id: f.id, name: f.name, subgroup: f.subgroup })) }, null, 2));
console.log(`\nPropuesta: ${path.relative(process.cwd(), out)}`);
