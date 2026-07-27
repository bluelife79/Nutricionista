#!/usr/bin/env node
// Aplica a database.json (IDEMPOTENTE):
//  A) Reclasificación de los 151 other_fat (lee reclassify_other_fat.proposed.json).
//  B) clean_fat por defecto en TODA la categoría fat (por subgrupo) con guard anti-noise.
//  C) Rescate de aceitunas mal categorizadas (other/carbs → fat/other_fat clean_fat:true).
//
// Uso: node scripts/apply_clean_fat.js            (dry-run, muestra cambios)
//      node scripts/apply_clean_fat.js --write     (escribe database.json + backup)

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DB = path.join(ROOT, "database.json");
const PROP = path.join(__dirname, "reclassify_other_fat.proposed.json");
const WRITE = process.argv.includes("--write");

const raw = fs.readFileSync(DB, "utf8");
const db = JSON.parse(raw);
const arr = Array.isArray(db) ? db : db.foods || [];
const proposed = JSON.parse(fs.readFileSync(PROP, "utf8")).proposed;

const N = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Detector de "noise" por nombre — guard para no marcar clean por defecto algo sucio
// que esté escondido en olive_oil/nuts_seeds/other_oils/avocado.
const NOISE_NAME =
  /(chocolat|xocolat|cacao|cocoa|turron|pralin|nutella|nocilla|gianduja|bombon|muesli|financ|canistrelli|almendrado|crujient|kaonut|con miel|garrapin|glasead|mazapan|barrita|\btort|coques d|galleta|espolvoread|mayon|alioli|allioli|ali oli|\bsalsa|aliño|alino|aderezo|vinagreta|ketchup|mostaza|cesar|caesar|tartar|tzatziki|sour ?crea|guacamole|romesco|pesto|\bmojo|sofrito|calve|mortadel|sobrasad|sobrassad|chorizo|\bpate\b|paté|foie|salami|salchich|fiambre|\bjamon\b|jamón|bacon|panceta|tocino|chicharron|mascarpone|fundente|untable|philadelph|\bbrie\b|camembert|triangul|fromage|formatge|\bligera\b|mantequ|manteca|margarin|\bbutter\b|beurre|kochbutter|matiere grasse|hummus|houmous|tahin)/;

// Guard de pescado / carne / verdura-frita: conservas "en aceite" y platos que
// quedaron en subgrupos de aceite/frutos secos pero NO son grasa limpia.
// OJO: NO incluye "frit" pelado (para no romper "almendras fritas", que es limpio):
// solo bases que no son grasa (atún, berenjena, patata...).
const PROTEIN_VEG_NAME =
  /(\batun|atún|bonito|\banchoa|sardin|caballa|ventresca|melva|calamar|mejillon|\bgamba|langostino|pulpo|surimi|salmon|salmón|merluza|bacalao|boqueron|\bpollo|\bpavo|ternera|\bcerdo|\blomo|berenjena|patata|moscada)/;

const CLEAN_SUBGROUPS = new Set([
  "olive_oil",
  "other_oils",
  "nuts_seeds",
  "avocado",
]);

const propById = new Map();
const propByName = new Map();
for (const p of proposed) {
  if (p.id != null) propById.set(String(p.id), p);
  propByName.set(N(p.name), p);
}

let cA = 0,
  cB = 0,
  cC = 0;
const changes = [];

function setField(f, key, val) {
  if (f[key] !== val) {
    f[key] = val;
    return true;
  }
  return false;
}

for (const f of arr) {
  // ── A) Reclasificación de los 151 (match por id, fallback nombre) ──
  const p =
    (f.id != null && propById.get(String(f.id))) || propByName.get(N(f.name));
  const isTargetOtherFat =
    f.category === "fat" && f.subgroup === "other_fat" && p;

  if (isTargetOtherFat) {
    let ch = false;
    ch = setField(f, "category", p.to.category) || ch;
    ch = setField(f, "subgroup", p.to.subgroup) || ch;
    if (p.to.clean_fat === null) {
      // no-grasa: recategorizado; no lleva clean_fat
      if ("clean_fat" in f) {
        delete f.clean_fat;
        ch = true;
      }
    } else {
      ch = setField(f, "clean_fat", p.to.clean_fat) || ch;
    }
    if (ch) {
      cA++;
      changes.push(`A  ${f.name}  → ${f.category}/${f.subgroup} clean=${f.clean_fat ?? "—"}`);
    }
    continue;
  }

  // ── B) clean_fat por defecto en el resto de category fat ──
  if (f.category === "fat") {
    const nm = N(f.name);
    const noisy = NOISE_NAME.test(nm) || PROTEIN_VEG_NAME.test(nm);
    const want = CLEAN_SUBGROUPS.has(f.subgroup) && !noisy;
    if (setField(f, "clean_fat", want)) {
      cB++;
      if (changes.length < 9999)
        changes.push(`B  ${f.name}  [${f.subgroup}] clean=${want}${noisy ? " (noise-name)" : ""}`);
    }
    continue;
  }

  // ── C) Rescate de aceitunas fuera de fat ──
  // Solo other/other y carbs/* dominadas por aceituna; excluir mezclas claras.
  const n = N(f.name);
  const isOliveName = /(aceitun|\bolives?\b|green pitted)/.test(n) &&
    !/aceite|oil|öl|huile/.test(n);
  const isMixedNonOlive =
    /(queso|cheese|sardin|salteado|vasca|preparado de queso|atun|atún)/.test(n);
  const rescueable =
    isOliveName &&
    !isMixedNonOlive &&
    (f.category === "other" || f.category === "carbs");
  if (rescueable) {
    setField(f, "category", "fat");
    setField(f, "subgroup", "other_fat");
    setField(f, "clean_fat", true);
    cC++;
    changes.push(`C  ${f.name}  (era ${f.category_prev || "?"}) → fat/other_fat clean=true`);
  }
}

console.log(`\n=== CAMBIOS ===`);
console.log(`A) reclasificación 151 other_fat:     ${cA}`);
console.log(`B) clean_fat default en fat restante:  ${cB}`);
console.log(`C) rescate aceitunas fuera de fat:     ${cC}`);
console.log(`TOTAL items modificados: ${cA + cB + cC}`);

console.log(`\n=== muestra de cambios (primeros 40) ===`);
changes.slice(0, 40).forEach((c) => console.log("  " + c));
if (changes.length > 40) console.log(`  ... (+${changes.length - 40} más)`);

if (WRITE) {
  const backup = path.join(ROOT, "database.backup.json");
  fs.writeFileSync(backup, raw);
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
  console.log(`\n✅ ESCRITO. Backup en ${path.relative(process.cwd(), backup)}`);
} else {
  console.log(`\n(dry-run — corré con --write para aplicar)`);
}
