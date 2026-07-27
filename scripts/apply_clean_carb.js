#!/usr/bin/env node
// IDEMPOTENTE. Aplica:
//  A) Reclasificación de carbs según reclassify_carbs.proposed.json.
//  B) Default clean_carb por subgrupo en residuales de category=carbs.
//  C) Backup database.json.
//
// Uso: node scripts/apply_clean_carb.js          (dry-run)
//      node scripts/apply_clean_carb.js --write

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DB = path.join(ROOT, "database.json");
const PROP = path.join(__dirname, "reclassify_carbs.proposed.json");
const WRITE = process.argv.includes("--write");

const raw = fs.readFileSync(DB, "utf8");
const db = JSON.parse(raw);
const arr = Array.isArray(db) ? db : db.foods || [];
const proposed = JSON.parse(fs.readFileSync(PROP, "utf8")).proposed;

const N = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’“”'`]/g, "");

// Guard noise por nombre (mismo principio que apply_clean_fat).
const NOISE_NAME =
  /(\bgalleta|sobao|pudin|pudding|magdalena|donut|muffin|financier|almendrado|canistrelli|\bbollo|croissant|cookie|brownie|tarta|pastel|bizcocho|cupcake|pastas? de te|tostadit|alfajor|gusanit|chocolat|cacao|turron|pralin|nutella|nocilla|gofre|waffle|napolitana|ensaimada|hojaldre|regaliz|chuche|caramelo|gomin|haribo|pasta de fruta|en almib|fruta glaseada|\bazucar|fructosa|sirope|jarabe|melaza|\bmiel\b|jalea real|mermelada|confitura|edulcorant|cereales? desayuno|all.?bran|bran flakes|frosti|chocapic|special k|honey ?pop|cuquis|crocks|smacks|krispies|nesquik|kellogg|corn ?flakes|\bchips\b|prefrit|gusanito|doritos|cheetos|palitos|pretzel|cracker|nachos|kikos|cortezas|fritos? de (maiz|maíz)|maiz frito|maíz frito|haba frita|tomate frito|\bpizza|empanada|croqueta|lasaña|lasagna|canelones|raviolis|sopa de sobre|sopa instantanea|sushi|tempura|nuggets|ensaladill|comida preparada|plato preparado|albondig|ensalada (de )?(pasta|rucula|rucola|arroz)|pasta (a la )?(bolo|carbon|napol)|macarron.*(bolo|alto contenid)|\bmaria\b|petit beurre|picatoste|sticks? salad|bretzel|biscuit|filoo|momento dulce|barquill|yogu(rt|r).*frut|combinado.*(fruta|frutos)|duo de frutas|crunchy.*frut|mini cakes.*fruta|pure de fruta)/;

const CLEAN_SUBGROUPS = new Set([
  "grains", "tubers", "legumes", "fruit", "vegetables",
]);
const NOISE_SUBGROUPS = new Set([
  "sweets_bakery", "other_carbs", "other", "other_dairy", "basic_dairy",
  "fish", "other_fat", "nuts_seeds",
]);

const propById = new Map();
const propByName = new Map();
for (const p of proposed) {
  if (p.id != null) propById.set(String(p.id), p);
  propByName.set(N(p.name), p);
}

let cA = 0, cB = 0;
const changes = [];

function setField(f, key, val) {
  if (f[key] !== val) { f[key] = val; return true; }
  return false;
}

for (const f of arr) {
  if (f.category !== "carbs" && !propById.has(String(f.id)) && !propByName.has(N(f.name))) continue;

  const p = (f.id != null && propById.get(String(f.id))) || propByName.get(N(f.name));

  // ── A) Item en propuesta — aplicar destino ──
  if (p) {
    let ch = false;
    ch = setField(f, "category", p.to.category) || ch;
    ch = setField(f, "subgroup", p.to.subgroup) || ch;
    if (p.to.clean_carb === null) {
      if ("clean_carb" in f) { delete f.clean_carb; ch = true; }
    } else {
      ch = setField(f, "clean_carb", p.to.clean_carb) || ch;
    }
    if (ch) {
      cA++;
      if (changes.length < 9999)
        changes.push(`A  ${f.name}  → ${f.category}/${f.subgroup} clean=${f.clean_carb ?? "—"}  [${p.rule}]`);
    }
    continue;
  }

  // ── B) Residual category=carbs — default por subgrupo con guard de nombre ──
  if (f.category === "carbs") {
    const noisy = NOISE_NAME.test(N(f.name));
    let want;
    if (noisy) want = false;
    else if (CLEAN_SUBGROUPS.has(f.subgroup)) want = true;
    else if (NOISE_SUBGROUPS.has(f.subgroup)) want = false;
    else want = false; // null/undefined → conservador
    if (setField(f, "clean_carb", want)) {
      cB++;
      if (changes.length < 9999)
        changes.push(`B  ${f.name}  [${f.subgroup}] clean=${want}${noisy ? " (noise-name)" : ""}`);
    }
  }
}

console.log(`\n=== CAMBIOS ===`);
console.log(`A) reclasificación matcheada:        ${cA}`);
console.log(`B) clean_carb default residual:       ${cB}`);
console.log(`TOTAL items modificados: ${cA + cB}`);

console.log(`\n=== muestra de cambios (primeros 40) ===`);
changes.slice(0, 40).forEach((c) => console.log("  " + c));
if (changes.length > 40) console.log(`  ... (+${changes.length - 40} más)`);

if (WRITE) {
  const backup = path.join(ROOT, "database.backup.json");
  // Preserva backup previo si ya existe — escribe uno nuevo con suffix.
  if (fs.existsSync(backup)) {
    const ts = backup.replace(".json", ".prev.json");
    fs.copyFileSync(backup, ts);
  }
  fs.writeFileSync(backup, raw);
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
  console.log(`\n✅ ESCRITO. Backup en ${path.relative(process.cwd(), backup)}`);
} else {
  console.log(`\n(dry-run — corré con --write para aplicar)`);
}
