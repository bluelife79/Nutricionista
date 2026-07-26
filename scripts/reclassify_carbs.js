#!/usr/bin/env node
// Clasificador heurístico determinístico para category=carbs.
// NO modifica BD. Produce propuesta auditable.
// Flag clean_carb: true = hidrato base real (arroz/avena/pan/pasta/patata/
// legumbre/fruta entera/grano crudo); false = snack/galleta/cereal desayuno/
// bollería/prefrita/plato preparado/dulce.

const fs = require("fs");
const path = require("path");

const DB = path.join(__dirname, "..", "database.json");
const db = JSON.parse(fs.readFileSync(DB, "utf8"));
const arr = Array.isArray(db) ? db : db.foods || [];
const items = arr.filter((f) => f.category === "carbs");

const N = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’“”'`]/g, "");

const RULES = [
  // ── PRIORIDAD ALTA: noise ANTES de non_carb, para que "Pastas de te"
  // caiga en bakery y no en beverage por el "te" interno.

  // ── 1. NOISE bollería/dulce (incluye azúcar puro y dulces concentrados) ──
  {
    rule: "noise_bakery_sweet",
    re: /(\bgalleta|sobao|pudin|pudding|pudín|magdalena|donut|donuts|muffin|financier|almendrado|canistrelli|bollito|\bbollo\b|croissant|cookie|brownie|tarta|pastel(ito)?|bizcocho|cupcake|pasta(s)? de te|barrita.*(chocolat|cereal|fruta)|tostadit|alfajor|gusanit|tort(a|as)? (de aceite|d.aceite)|pastas almendr|crujient|kaonut|garrapin|glasead|bombon|chocolat|cacao|turron|pralin|nutella|nocilla|crema.*cacao|crema.*chocolat|crema para untar|gofre|wafel|waffle|napolitana|ensaimada|magdal|hojaldre|regaliz|chuche|caramelo|gomin|haribo|pasta de fruta|frutas? confit|fruta.*almib|en almib|fruta glaseada)/,
    to: { category: "carbs", subgroup: "sweets_bakery", clean_carb: false },
  },
  // Azúcar puro / endulzantes naturales concentrados (sin proteína/fibra).
  {
    rule: "noise_pure_sugar",
    re: /(\bazucar|azúcar|fructosa|sacarosa|dextrosa|maltosa|glucosa|sirope|jarabe|melaza|panela|miel\b|jalea real|mermelada|confitura|edulcorant|stevia|agave)/,
    to: { category: "carbs", subgroup: "sweets_bakery", clean_carb: false },
  },
  {
    rule: "noise_breakfast_cereal",
    re: /(cereales? desayuno|cereal(es)? (de )?desayuno|all.?bran|bran flakes|frosti|chocapic|special k|honey ?pop|cuquis|crocks?|choco.?(tiz|krispies|pic|flake)|smacks|krispies|nesquik|kellogg|corn ?flakes|muesli.*(chocolat|miel|azuc)|granola.*(chocolat|miel|azuc)|cereales?.*(miel|chocolat|azuc)|cereales? en polvo soluble)/,
    to: { category: "carbs", subgroup: "sweets_bakery", clean_carb: false },
  },
  {
    rule: "noise_snack_salty",
    re: /(\bchips\b|\bprefrit|patatas? fritas?|patata.*frita|batata.*frit|patata gajo|gusanito|doritos|cheetos|palitos|pretzel|cortez(a|as) (de )?(maiz|cerdo|trigo)|cracker|nachos|kikos|cortezas|fritos? de (maiz|maíz)|maiz frito|maíz frito|haba frita|tomate frito)/,
    to: { category: "carbs", subgroup: "sweets_bakery", clean_carb: false },
  },
  {
    rule: "noise_prepared_dish",
    re: /(\bpizza|empanada|croqueta|lasaña|lasagna|canelones|raviolis|sopa de sobre|sopa instantanea|paella preparada|risotto preparado|sushi|tempura|nuggets|ensaladill|comida preparada|plato preparado|preparado vegetal|cocktail.*pan|albondig|abadejo.*arroz|merluza.*arroz|atun.*arroz|atún.*arroz|pollo.*arroz|carne.*arroz|cordon ?bleu|ensalada (de )?(pasta|rucula|rucola|arroz)|pasta (a la )?(bolo|carbon|napol|amatric)|macarron.*(bolo|alto contenid|napol|carbon)|spaghetti.*(bolo|carbon|napol)|fideua preparad|paella.*preparad)/,
    to: { category: "carbs", subgroup: "sweets_bakery", clean_carb: false },
  },
  // Galletas brand y picatostes/sticks de bollería.
  {
    rule: "noise_brand_cookie",
    re: /(\bmaria\b|petit beurre|petit-beurre|picatoste|sticks salad|sticks?\s+(?!de pesc)|bretzel|mini toast|biscuit|filoo|momento dulce|petitos|barquill|surtido galleta|surtido dulce|cookies?\b)/,
    to: { category: "carbs", subgroup: "sweets_bakery", clean_carb: false },
  },
  // Fruta procesada con azúcar / lácteo con fruta / mixtos fruta+otros.
  {
    rule: "noise_fruit_processed",
    re: /(fruta.*almib|en almib|fruta glaseada|frutas? confit|crunchy.*frut|combinado.*(fruta|frutos)|duo de frutas|mini cakes.*fruta|pure de fruta|puré de fruta|fruta.*chocolat|yogu(rt|r).*fruta|yogur.*frut|yogurt 0%.*fruta|cereal.*frut|barrita.*frut)/,
    to: { category: "carbs", subgroup: "sweets_bakery", clean_carb: false },
  },
  {
    rule: "noise_other_processed",
    re: /(\bsuper cuquis|crocks choco|choco.?tiz|tostadit|genovesa|sazonador)/,
    to: { category: "carbs", subgroup: "sweets_bakery", clean_carb: false },
  },

  // ── 2. NO-CARB: sacar de category carbs ──
  {
    rule: "non_carb_spice",
    re: /(canela|tomillo|\bazafran|azafrán|\bclavo\b|curry|sazonador|pimienta|oregano|orégano|laurel|romero|comino|jengibre.*polvo|nuez moscada|albahaca seca|perejil seco|eneldo|cilantro seco|cardamomo|hierbabuena seca|menta seca|estragon|salvia seca|hinojo)/,
    to: { category: "other", subgroup: "other", clean_carb: null },
  },
  {
    rule: "non_carb_fish_meat",
    macroFn: (f) => f.protein > 15 && f.carbs < 5,
    to: { category: "protein", subgroup: "other", clean_carb: null },
  },
  {
    rule: "non_carb_fat",
    re: /(margarina|mantequ|manteca|^aceite\b|\boil\b|crema de cacahu|crema de almend)/,
    to: { category: "fat", subgroup: "other_fat", clean_carb: null },
  },
  // Frutos secos sueltos en carbs → fat/nuts_seeds.
  {
    rule: "non_carb_nuts",
    re: /(\bpiñones?\b|\bpinones?\b|\bnueces?\b|^almendra|^pistach|^anacard|^avellan|^cacahuet|macadamia|pipas? de calab|pipas? de girasol|semilla de chia|chia\b)/,
    to: { category: "fat", subgroup: "nuts_seeds", clean_carb: null },
  },
  // Yogur/leche/queso mal categorizados en carbs → dairy.
  {
    rule: "non_carb_dairy",
    re: /(yogu(rt|r)\b|^leche\b|\bqueso\b|kefir|cuajada|requeson|requesón|skyr|cottage cheese|fromage blanc)/,
    to: { category: "dairy", subgroup: "whole_dairy", clean_carb: null },
  },
  {
    rule: "non_carb_beverage",
    re: /(\bcafe\b|café|infusion|infusión|\binfus|\btea bag|matcha|té verde|te verde|té negro|te negro|batido|leche de soja|leche de avena|leche de almend|bebida vegetal|zumo|jugo de|refresco|cola light|coca cola|nestea|aquarius)/,
    to: { category: "other", subgroup: "other", clean_carb: null },
  },
  // Condimentos puros (NO platos con salsa).
  {
    rule: "non_carb_condiment",
    re: /^(vinagre|salsa de soja|salsa worcest|salsa teriyaki|aderezo|ketchup|mostaza|tabasco|lecitina|levadura)\b/,
    to: { category: "other", subgroup: "other", clean_carb: null },
  },

  // ── 3. PASTA REAL — rescatar de other_carbs/null → grains, clean ──
  {
    rule: "clean_pasta_real",
    re: /(\bspaghetti|spaguetti|macaroni|maccarones|fideuá|fideua|fideos?\b|espirales|cous.?cous|tallarines|tagliatelle|penne|farfalle|ravioli|gnocchi|pasta alimenticia|fettuccine|fideo integral|3 min spaghetti)/,
    to: { category: "carbs", subgroup: "grains", clean_carb: true },
  },

  // ── 4. PAN/BISCOTE REAL — rescatar → grains, clean ──
  {
    rule: "clean_bread_real",
    re: /(panecill|biscote|pan integral|pan tostado|pan blanco|pan de centeno|pan de avena|pan de maíz|pan de maiz|pan de molde|pan rallado|pan de espelta|pan rustic|pan candeal|baguette|chapata|hogaza|pan.*cereal|pan.*semill|pan.*espelta|pan.*centeno|pan.*avena|pan.*especias|barra (de )?pan|pan rustic)/,
    to: { category: "carbs", subgroup: "grains", clean_carb: true },
  },

  // ── 5. ARROZ/AVENA/QUINOA reales + harinas + maíz + gofio + sémola + almidón ──
  {
    rule: "clean_grain_base",
    re: /(\barroz\b|arroz integral|arroz basmati|arroz especial (paella|ensalada|sushi|guarnicion|guarnición)|copos avena|copos de avena|avena en copos|avena molida|\bavena\b|quinoa|trigo sarraceno|cebada|centeno|espelta|mijo|sorgo|amaranto|bulgur|polenta|cous.?cous|cereales? integrales?|\bsalvado\b|\bgermen\b|harina(s)?\b|semola|sémola|gofio|muesli|granola natural|almidon|almidón|maíz|maiz|trigo\b)/,
    to: { category: "carbs", subgroup: "grains", clean_carb: true },
  },
  {
    rule: "clean_vegetable_whole",
    re: /(repollo|col\b|coliflor|brocoli|brócoli|lechuga|tomate\b|cebolla|ajo entero|ajo\b|zanahoria|calabacin|calabacín|pimiento|berenjena|champinon|champiñón|seta|esparrago|espárrago|apio|hinojo fresco|puerro|alcachofa)/,
    to: { category: "vegetables", subgroup: "vegetables", clean_carb: null },
  },

  // ── 6. TUBÉRCULOS reales ──
  {
    rule: "clean_tuber_base",
    re: /(\bpatata\b|patatas?( asadas?| hervidas?| cocidas?| al horno| cruda)?|boniato|batata|yuca|mandioca|chufa|name|ñame|tupinambo)/,
    to: { category: "carbs", subgroup: "tubers", clean_carb: true },
  },

  // ── 7. LEGUMBRES ──
  {
    rule: "clean_legume",
    re: /(garbanz|lentej|judia|judía|alubia|frijol|haba seca|haba\b|soja\b|soja germinada|edamame|altramuz|cacahuet.*tostado.*sin|guisant|fabe|caraota|pinto bean|black bean|mung)/,
    to: { category: "carbs", subgroup: "legumes", clean_carb: true },
  },

  // ── 8. FRUTA ENTERA — clean (Hugo no excluye explícitamente) ──
  {
    rule: "clean_fruit",
    re: /(manzana|pera|naranja|mandarin|platano|plátano|banana|uva\b|pasas|fresa|frambuesa|arandano|mora|cereza|melon|sandia|sandía|kiwi|pina|piña|mango|papaya|piel de fruta|pomelo|nectarina|melocoton|albaricoque|ciruela|higo|datil|chirimoya|caqui|granada|maracuya|lima\b|limon|limón|coco rallad|orejones|fruta deshidrat)/,
    to: { category: "carbs", subgroup: "fruit", clean_carb: true },
  },
];

const proposed = [];
const residual = [];

for (const f of items) {
  const n = N(f.name);
  let matched = null;
  for (const r of RULES) {
    if (r.re && r.re.test(n)) { matched = r; break; }
    if (r.macroFn && r.macroFn(f)) { matched = r; break; }
  }
  if (!matched) { residual.push(f); continue; }
  proposed.push({
    id: f.id,
    name: f.name,
    kcal: f.calories,
    macros: { P: f.protein, C: f.carbs, F: f.fat },
    from: { category: f.category, subgroup: f.subgroup },
    to: matched.to,
    rule: matched.rule,
  });
}

const byRule = {};
for (const p of proposed) (byRule[p.rule] = byRule[p.rule] || []).push(p);

const order = [
  "clean_grain_base", "clean_pasta_real", "clean_bread_real",
  "clean_tuber_base", "clean_legume", "clean_fruit",
  "noise_breakfast_cereal", "noise_snack_salty", "noise_bakery_sweet",
  "noise_prepared_dish", "noise_other_processed",
  "non_carb_spice", "non_carb_fish_meat", "non_carb_fat",
  "non_carb_beverage", "non_carb_condiment",
];

console.log(`\n=== PROPUESTA carbs (${items.length}) ===`);
for (const rule of order) {
  const g = byRule[rule];
  if (!g || !g.length) continue;
  const dst = g[0].to;
  const cc = dst.clean_carb === null ? "—" : dst.clean_carb ? "clean ✅" : "NOISE ⛔";
  console.log(`\n── ${rule} → ${dst.category}/${dst.subgroup} [clean_carb:${cc}] (${g.length})`);
  g.slice(0, 6).forEach((p) => console.log(`   • ${p.name} [k:${p.kcal}]`));
  if (g.length > 6) console.log(`   ... (+${g.length - 6} más)`);
}

console.log(`\n=== RESIDUAL (${residual.length}) — sample ===`);
residual.slice(0, 30).forEach((f) => console.log(`   ? ${f.subgroup}  ${f.name}  [k:${f.calories} raw=${f.raw_ingredient} rte=${f.ready_to_eat}]`));
if (residual.length > 30) console.log(`   ... (+${residual.length - 30} más)`);

const cleanN = proposed.filter((p) => p.to.clean_carb === true).length;
const noiseN = proposed.filter((p) => p.to.clean_carb === false).length;
const nonN = proposed.filter((p) => p.to.clean_carb === null).length;
console.log(`\n=== RESUMEN ===\n  clean: ${cleanN}\n  noise: ${noiseN}\n  no-carb: ${nonN}\n  residual: ${residual.length}\n  TOTAL: ${items.length}`);

const out = path.join(__dirname, "reclassify_carbs.proposed.json");
fs.writeFileSync(out, JSON.stringify({ proposed, residual: residual.map((f) => ({ id: f.id, name: f.name, subgroup: f.subgroup })) }, null, 2));
console.log(`\nPropuesta: ${path.relative(process.cwd(), out)}`);
