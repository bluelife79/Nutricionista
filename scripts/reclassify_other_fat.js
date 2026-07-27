#!/usr/bin/env node
// Heurística determinística para reclasificar category=fat / subgroup=other_fat.
// NO modifica la BD: produce una propuesta auditable (scripts/reclassify_other_fat.proposed.json)
// y la imprime agrupada para revisión humana antes de aplicar.
//
// Destino por item: { category, subgroup, clean_fat } + regla que disparó.
// clean_fat = grasa de alimento entero/single-ingredient (aceites, frutos secos,
// semillas, aceitunas, aguacate). Lo demás (salsas, untables, quesos-grasa,
// embutido, dulces, manteca/margarina, dips, preparados) = clean_fat:false.

const fs = require("fs");
const path = require("path");

const DB = path.join(__dirname, "..", "database.json");
const db = JSON.parse(fs.readFileSync(DB, "utf8"));
const arr = Array.isArray(db) ? db : db.foods || [];
const items = arr.filter(
  (f) => f.category === "fat" && f.subgroup === "other_fat"
);

const N = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Reglas ordenadas: la PRIMERA que matchea gana. El orden importa
// (dulce antes que fruto seco: "Mini almendrado" es dulce, no almendra).
const RULES = [
  // 1. No es grasa: sacar de category fat. (sin \b final → matchea plural)
  {
    rule: "non_fat_vegetable",
    re: /(zanahoria|tomate seco|pimiento(s)? )/,
    to: { category: "vegetables", subgroup: "vegetables", clean_fat: null },
  },
  // Pescado/marisco (incluye "X en aceite": atún/sardinas/ventresca conservados).
  // NO matchea si lleva aceituna/oliva/pesto (eso es oliva o salsa, no pescado).
  {
    rule: "non_fat_seafood",
    re: /^(?!.*(aceitun|oliva|pesto)).*(moules|mejillon|cangrejo|ensaladilla|surimi|\bgamba|langostino|\batun|atún|sardin|saefinill|caballa|melva|ventresca|bonito)/,
    to: { category: "protein", subgroup: "seafood", clean_fat: null },
  },
  {
    rule: "non_fat_beverage",
    re: /(coconut milk|leche de coco|\bbebida)/,
    to: { category: "other", subgroup: "other", clean_fat: null },
  },

  // 2. Dulce / bollería / chocolate / untables dulces / frutos secos azucarados.
  // ANTES que aceites y frutos secos: "Tortas de aceite" = galleta, "Negro
  // avellanas" = avellana con chocolate, "Crema avellanas con aceite girasol" =
  // untable dulce tipo nutella.
  {
    rule: "noise_sweet_bakery",
    re: /(chocolat|xocolat|cacao|cocoa|turron|pralin|nutella|nocilla|gianduja|bombon|muesli|financ|canistrelli|almendrado|pastas almendr|crujient|kaonut|con miel|garrapin|glasead|praline|mazapan|barrita|\btort|coques d|galleta|espolvoread|\b(negro|blanco)\b.*(avellan|almendr)|crema.*avellan.*(girasol|untar|cacao)|cacao.*avellan|truffel)/,
    to: { category: "fat", subgroup: "sweets_bakery", clean_fat: false },
  },

  // 3. Salsas / aderezos / aliños / cremas-de-verdura (NOISE).
  {
    rule: "noise_sauce",
    re: /(mayon|alioli|allioli|ali oli|\bsalsa|aliño|alino|aderezo|vinagreta|ketchup|mostaza|cesar|caesar|tartar|tzatziki|sour ?crea|creme fra|guacamole|romesco|pesto|\bmojo|mojó|sofrito|calve|crema de (esparrag|alcachof|verdur|calabac|champi)|finas hierbas|dados con ajo)/,
    to: { category: "fat", subgroup: "other_fat", clean_fat: false },
  },

  // 4. Embutido / cárnico curado (NOISE).
  {
    rule: "noise_cured",
    re: /(mortadel|sobrasad|sobrassad|chorizo|\bpate\b|paté|\bpate |foie|salami|salchich|fiambre|\bjamon\b|jamón|bacon|panceta|tocino|lardo|chicharron)/,
    to: { category: "fat", subgroup: "other_fat", clean_fat: false },
  },

  // 5. Queso-grasa / untables salados (NOISE).
  {
    rule: "noise_cheese",
    re: /(queso|cheese|mascarpone|fundente|untable|philadelph|\bbrie\b|camembert|triangul|fromage|formatge|\bligera\b|\bcasero\b)/,
    to: { category: "fat", subgroup: "other_fat", clean_fat: false },
  },

  // 6. Manteca / margarina (NOISE → butter_margarine).
  {
    rule: "noise_butter_margarine",
    re: /(mantequ|manteca|margarin|\bbutter\b|beurre|\bghee\b|kochbutter|matiere grasse)/,
    to: { category: "fat", subgroup: "butter_margarine", clean_fat: false },
  },

  // 7. Dips (hummus, tahin) (NOISE).
  {
    rule: "noise_dip",
    re: /(hummus|houmous|babaganus|baba ganus|\btahin|tahini)/,
    to: { category: "fat", subgroup: "other_fat", clean_fat: false },
  },

  // 8. Condimentos / especias (NOISE — no son grasa de intercambio).
  {
    rule: "noise_condiment",
    re: /(mix pimienta|pimienta|especia|condiment)/,
    to: { category: "fat", subgroup: "other_fat", clean_fat: false },
  },

  // 9. Crema de frutos secos PURA (CLEAN — single ingredient, sin cacao/dulce).
  {
    rule: "clean_nut_butter",
    re: /(crema de cacahu|crema de almend|crema de avellanas? (100|pura|natural)|peanut butter|nut butter|crema de pistach|crema de anacard)/,
    to: { category: "fat", subgroup: "nuts_seeds", clean_fat: true },
  },

  // 10. Aceites reales (CLEAN). Ya filtrados los "X en aceite" y galletas arriba.
  {
    rule: "clean_olive_oil",
    re: /(aceite de oliva|olivenol|olivenöl|huile d.?oliv|huil d.oliv|olio (di )?oliv|oli d.oliv|aceite.*oliva)/,
    to: { category: "fat", subgroup: "olive_oil", clean_fat: true },
  },
  {
    rule: "clean_other_oil",
    re: /(aceite (para |refinad|virgen|de girasol|hipocal|de semill)|\baceite$|\boil\b|\böl\b|sonnenblum|aceite virgen|girasol$|sunflower|linaza|colza|aceite de sesamo)/,
    to: { category: "fat", subgroup: "other_oils", clean_fat: true },
  },

  // 11. Aceitunas (CLEAN). Se quedan en other_fat (NO olive_oil: una aceituna
  // ~120 kcal no es aceite ~900 kcal; el flag clean_fat hace el trabajo del gate).
  // Olivada/tapenade = oliva triturada → clean.
  {
    rule: "clean_olives",
    re: /(aceitun|oliva(s)?\b|\bolive|olivada|olives|oli d)/,
    to: { category: "fat", subgroup: "other_fat", clean_fat: true },
  },

  // 12. Aguacate (CLEAN).
  {
    rule: "clean_avocado",
    re: /(aguacate|avocado|\bpalta)/,
    to: { category: "fat", subgroup: "avocado", clean_fat: true },
  },

  // 13. Frutos secos / semillas reales (CLEAN → nuts_seeds).
  // Tostados/salados/fritos planos siguen siendo limpios (single ingredient).
  // Los azucarados/chocolateados ya fueron capturados por noise_sweet_bakery.
  {
    rule: "clean_nuts_seeds",
    re: /(almendr|cacahuet|pistach|anacard|avellan|\bnuez|\bnueces|macadamia|\bpipa|pipas|semilla|\bsesamo|sésamo|pinon|piñon|\bpinones|castana|castaña|pecan|nuez de brasil)/,
    to: { category: "fat", subgroup: "nuts_seeds", clean_fat: true },
  },
];

const proposed = [];
const residual = [];

for (const f of items) {
  const n = N(f.name);
  let matched = null;
  for (const r of RULES) {
    if (r.re.test(n)) {
      matched = r;
      break;
    }
  }
  if (!matched) {
    residual.push(f);
    continue;
  }
  proposed.push({
    id: f.id,
    code: f.code,
    name: f.name,
    kcal: f.calories,
    macros: { P: f.protein, C: f.carbs, F: f.fat },
    from: { category: f.category, subgroup: f.subgroup },
    to: matched.to,
    rule: matched.rule,
  });
}

// Agrupar para impresión.
const byRule = {};
for (const p of proposed) (byRule[p.rule] = byRule[p.rule] || []).push(p);

const order = [
  "clean_olive_oil",
  "clean_other_oil",
  "clean_olives",
  "clean_avocado",
  "clean_nuts_seeds",
  "clean_nut_butter",
  "noise_sauce",
  "noise_cured",
  "noise_cheese",
  "noise_sweet_bakery",
  "noise_butter_margarine",
  "noise_dip",
  "non_fat_vegetable",
  "non_fat_seafood",
  "non_fat_beverage",
];

console.log(`\n=== PROPUESTA reclasificación other_fat (${items.length} items) ===\n`);
for (const rule of order) {
  const g = byRule[rule];
  if (!g || !g.length) continue;
  const dst = g[0].to;
  const cf =
    dst.clean_fat === null ? "—" : dst.clean_fat ? "clean ✅" : "NOISE ⛔";
  console.log(
    `\n── ${rule}  →  ${dst.category}/${dst.subgroup}  [clean_fat: ${cf}]  (${g.length})`
  );
  for (const p of g) {
    console.log(
      `   • ${p.name}  [kcal:${p.kcal} P:${p.macros.P} C:${p.macros.C} F:${p.macros.F}]`
    );
  }
}

console.log(`\n=== RESIDUAL sin clasificar (${residual.length}) — REVISIÓN MANUAL ===`);
for (const f of residual) {
  console.log(
    `   ? ${f.name}  [kcal:${f.calories} P:${f.protein} C:${f.carbs} F:${f.fat}]`
  );
}

// Resumen.
const cleanN = proposed.filter((p) => p.to.clean_fat === true).length;
const noiseN = proposed.filter((p) => p.to.clean_fat === false).length;
const nonfatN = proposed.filter((p) => p.to.clean_fat === null).length;
console.log(
  `\n=== RESUMEN ===\n  clean: ${cleanN}\n  noise: ${noiseN}\n  no-grasa (recategorizar): ${nonfatN}\n  residual: ${residual.length}\n  TOTAL: ${items.length}`
);

const out = path.join(__dirname, "reclassify_other_fat.proposed.json");
fs.writeFileSync(
  out,
  JSON.stringify({ proposed, residual: residual.map((f) => ({ id: f.id, name: f.name })) }, null, 2)
);
console.log(`\nPropuesta escrita en ${path.relative(process.cwd(), out)}`);
