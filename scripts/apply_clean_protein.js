#!/usr/bin/env node
// IDEMPOTENTE. Aplica reclasificación protein + default clean_protein por
// subgrupo en residuales con guard de noise por nombre.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DB = path.join(ROOT, "database.json");
const PROP = path.join(__dirname, "reclassify_protein.proposed.json");
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

// Guard noise para residual (mismo principio que apply_clean_carb / clean_fat).
const NOISE_NAME =
  /(\bfrit(o|a|os|as)\b|rebozad|empanad|nugget|milanesa|croqueta|tempura|palitos? (de )?(pesca|merluza|cangrej|pollo|jamon)|fingers?|fishstick|fish ?stick|fritter|breaded|\bwieners?\b|big pavo|iberitos|salchich|frankfurt|hot ?dog|salami|mortadel|chorizo|jamon (serrano|curado|iber|york|cocido)|jamón (serrano|curado|iber|york|cocido)|fiambre|sobrasad|sobrassad|fuet|longaniz|butifarr|morcill|cecina|bacon|panceta|tocino|lardo|chicharron|salchichon|chichon|lomo embuchad|cordon ?bleu|\bpate\b|paté|foie|terrina|rillette|crema para untar|crema de (jamon|jamón|pollo|atun|atún)|pesto de (atun|atún|pollo)|surimi|kani|aceitunas? rellena|burger meat|preparado de carne|hamburgues(a|as) preparad|kebab preparado|en aceite (de oliva|de girasol|vegetal|s\/e)|en a leite|en escabech|enlatad(o|a).*aceite|migas de (atun|atún)|atun (claro )?(en )?aceite|\bsalaz(o|on|ón)|bacalao salad(o|a)|arenque salad|anchoa salad|\bpizza|empanada (de|con)|lasaña|lasagna|canelones|ravioli|paella preparada|risotto preparado|sushi preparado|ensaladill|preparado vegetal|en salsa$|con salsa|teriyaki listo|torreznos)/;

const CLEAN_SUBGROUPS = new Set([
  "meat_lean", "meat", "meat_fatty",
  "fish_white", "fish_fatty", "fish",
  "eggs", "viscera", "seafood",
  "plant_protein", "legumes",
]);
const NOISE_SUBGROUPS = new Set([
  "processed_meat", "processed_protein",
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
  if (f.category !== "protein") continue;

  const p = (f.id != null && propById.get(String(f.id))) || propByName.get(N(f.name));

  // ── A) Matcheado por clasificador ──
  if (p) {
    let ch = false;
    ch = setField(f, "category", p.to.category) || ch;
    ch = setField(f, "subgroup", p.to.subgroup) || ch;
    if (p.to.clean_protein === null) {
      if ("clean_protein" in f) { delete f.clean_protein; ch = true; }
    } else {
      ch = setField(f, "clean_protein", p.to.clean_protein) || ch;
    }
    if (ch) {
      cA++;
      if (changes.length < 9999)
        changes.push(`A  ${f.name}  → ${f.subgroup} clean=${f.clean_protein ?? "—"}  [${p.rule}]`);
    }
    continue;
  }

  // ── B) Default por subgrupo + guard noise ──
  const noisy = NOISE_NAME.test(N(f.name));
  let want;
  if (noisy) want = false;
  else if (CLEAN_SUBGROUPS.has(f.subgroup)) want = true;
  else if (NOISE_SUBGROUPS.has(f.subgroup)) want = false;
  else want = false; // null/undefined/other → conservador
  if (setField(f, "clean_protein", want)) {
    cB++;
    if (changes.length < 9999)
      changes.push(`B  ${f.name}  [${f.subgroup}] clean=${want}${noisy ? " (noise-name)" : ""}`);
  }
}

console.log(`\n=== CAMBIOS ===`);
console.log(`A) reclasificación matcheada:        ${cA}`);
console.log(`B) clean_protein default residual:    ${cB}`);
console.log(`TOTAL items modificados: ${cA + cB}`);

console.log(`\n=== muestra de cambios (primeros 30) ===`);
changes.slice(0, 30).forEach((c) => console.log("  " + c));
if (changes.length > 30) console.log(`  ... (+${changes.length - 30} más)`);

if (WRITE) {
  const backup = path.join(ROOT, "database.backup.json");
  if (fs.existsSync(backup)) {
    fs.copyFileSync(backup, backup.replace(".json", ".prev.json"));
  }
  fs.writeFileSync(backup, raw);
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
  console.log(`\n✅ ESCRITO. Backup en ${path.relative(process.cwd(), backup)}`);
} else {
  console.log(`\n(dry-run — corré con --write para aplicar)`);
}
