#!/usr/bin/env node
/**
 * reclassify_canned_fish.js — Hugo audit (Feedback Elena), Bloque 2.
 *
 * Conservas de pescado/marisco mal clasificadas en bucket `fat`
 * (subgroup olive_oil / other_oils / fish-fat) o en buckets basura
 * (other/other, dairy). Por estar en `fat` rankean contra aceites y
 * frutos secos en vez de contra otras conservas de pescado.
 *
 * Fix: category -> "protein", macro_profile -> "protein",
 *      subgroup -> fish_fatty | fish_white | seafood (según especie),
 *      clean_protein -> true (conserva limpia, no frita/rebozada),
 *      se elimina clean_fat. Se guarda category_prev/subgroup_prev.
 *
 * Uso:
 *   node scripts/reclassify_canned_fish.js            # dry-run (no escribe)
 *   node scripts/reclassify_canned_fish.js --apply    # escribe database.json
 */
const fs = require("fs");
const path = require("path");

const DB = path.join(__dirname, "..", "database.json");
const APPLY = process.argv.includes("--apply");

const FATTY = /(at[uú]n|bonito|caballa|sardina|melva|anchoa|boquer|arenque|jurel|verdel|ventresca|salm[oó]n|trucha|anguila|sarda|caballa del sur)/i;
const WHITE = /(bacalao|merluza|pulpo|calamar|sepia|chipir[oó]n|rape|gallo|lenguado|pescadilla|congrio|raya|panga|perca|tilapia)/i;
const SEAFOOD = /(mejill[oó]n|almeja|berberecho|navaja|gamba|langostino|vieira|zamburi[ñn]a|cigala|n[eé]cora|pulpitos)/i;
const ANYFISH = new RegExp(FATTY.source + "|" + WHITE.source + "|" + SEAFOOD.source, "i");

// Conserve markers — debe parecer conserva, no pescado fresco.
const CONSERVE = /(aceite|escabeche|conserva|enlatad|en lata|\blata|al natural|en agua|salsa de tomate|en tomate|girasol|vegetal|soja|marinad|ahumad)/i;

// Productos preparados/compuestos que NO son conserva limpia de pescado.
const PREPARED = /(queso|relleno|pat[eé]|pizza|ensaladilla|banderilla|pincho|empanad|croqueta|bu[ñn]uelo|surimi|palitos|pizza|sushi|nigiri|cebolla caramelizada|peperoncini|h[ií]gado|viscera|hueva)/i;

function subgroupFor(name) {
  if (SEAFOOD.test(name)) return "seafood";
  if (WHITE.test(name)) return "fish_white";
  if (FATTY.test(name)) return "fish_fatty";
  return "fish_fatty"; // default: la mayoría de conservas en aceite son atún/bonito
}

const db = JSON.parse(fs.readFileSync(DB, "utf8"));

const targets = db.filter((f) => {
  const name = f.name || "";
  if (!ANYFISH.test(name)) return false;
  if (PREPARED.test(name)) return false;
  if (!CONSERVE.test(name)) return false;
  // Solo los mal clasificados: category fat, o category protein con subgroup basura,
  // o metidos en dairy/other.
  const cat = f.category;
  const sub = f.subgroup || "";
  const wrongFat = cat === "fat";
  const wrongDairy = cat === "dairy";
  const wrongOther = cat === "other";
  const wrongSubInProtein =
    cat === "protein" && !/^fish_fatty$|^fish_white$|^seafood$/.test(sub);
  return wrongFat || wrongDairy || wrongOther || wrongSubInProtein;
});

let changed = 0;
const log = [];
for (const f of targets) {
  const newSub = subgroupFor(f.name);
  const before = `${f.subgroup}/${f.category}`;
  if (f.category_prev === undefined) f.category_prev = f.category;
  if (f.subgroup_prev === undefined) f.subgroup_prev = f.subgroup;
  f.category = "protein";
  f.macro_profile = "protein";
  f.subgroup = newSub;
  f.clean_protein = true;
  if ("clean_fat" in f) delete f.clean_fat;
  changed++;
  log.push(`  ${before.padEnd(18)} -> ${newSub}/protein   ${f.name}`);
}

console.log(`Conservas pescado mal clasificadas: ${targets.length}`);
console.log(log.join("\n"));

// ── PASE 2: normalizar clean_protein en conservas LIMPIAS ────────────────────
// Una conserva (aceite/escabeche/al natural/en agua/tomate) NO es un frito ni
// un rebozado: es pescado preservado. Debe ser clean_protein:true para que,
// cuando sea ORIGEN, el gate de fritos (Hugo Regla 4) la proteja, y para que
// agrupe con otras conservas. Se excluyen fritos/rebozados/empanados/paté.
const FRIED = /(frito|frita|rebozad|empanad|tempura|a la romana|crujiente|nugget|palito|varita|fish ?finger|buñuelo|croqueta)/i;
let cpFixed = 0;
for (const f of db) {
  if (f.category !== "protein") continue;
  if (!/^fish_fatty$|^fish_white$|^seafood$/.test(f.subgroup || "")) continue;
  const name = f.name || "";
  if (!CONSERVE.test(name)) continue;        // solo conservas
  if (PREPARED.test(name) || FRIED.test(name)) continue; // no preparados/fritos
  if (f.clean_protein !== true) {
    f.clean_protein = true;
    cpFixed++;
  }
}
console.log(`\nclean_protein normalizado en conservas limpias: ${cpFixed}`);
console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"} — ${changed} reclasificados + ${cpFixed} clean_protein`);

if (APPLY) {
  fs.copyFileSync(DB, DB + ".prefish.bak");
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
  console.log(`Escrito database.json (backup: database.json.prefish.bak)`);
}
