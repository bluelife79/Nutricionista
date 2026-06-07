#!/usr/bin/env node
/**
 * reclassify_carb_noise.js — Hugo audit (Feedback Elena), Bloque 4 (patata).
 *
 * Patata (tubers, hidrato base) traía al TOP "Bio bebida de avena" y
 * "Cuatro frutas con avena": ambos category=carbs, clean_carb=TRUE → el
 * gate clean_carb (Hugo Regla 5) no los filtraba. Son ruido:
 *   - BEBIDAS (bebidas vegetales, batidos, horchata, zumos, isotónicas):
 *     una bebida NO es un hidrato base.
 *   - MEZCLAS DULCES / DESAYUNO (muesli, granola, porridge, gachas,
 *     "frutas con X", "X con frutas", crunch): cereal de desayuno / snack,
 *     no staple. Hugo spec #6 base_carb_subfamily: "penalize drinks,
 *     cookies, breakfast cereals".
 *
 * NO toca platos salados legítimos ("lentejas/garbanzos/arroz con verduras",
 * "puré de patata con verduras") — esos son intercambios reales.
 *
 * Fix: clean_carb=false (los saca del pool cuando el origen es hidrato base
 * limpio). Guarda clean_carb_prev. Idempotente.
 *
 * Uso: node scripts/reclassify_carb_noise.js [--apply]
 */
const fs = require("fs");
const path = require("path");

const DB = path.join(__dirname, "..", "database.json");
const APPLY = process.argv.includes("--apply");

const DRINK = /(\bbebida\b|\bdrink\b|batido|horchata|\bzumo|isot[oó]nic|polvo para preparar|n[eé]ctar|smoothie|licuad)/i;
// Procesados infantiles / golosina de fruta — no son fruta entera.
const BABY_PROCESSED = /(papilla|\bbaby\b|beb[eé] fruta|merienda|pouch|calipo|polo de|gelatina|gominola|bolitas|tarrina infantil|\+\s?\d+\s?meses|chuche)/i;
const SWEET_MIX = /(muesli|granola|porridge|gachas|crunch|frutas con |con frutas|con fruta\b|frutos secos y frutas|cereales con|copos.*(frutas|chocolate|miel)|barrita)/i;
// Mezclas de fruta — para un origen de fruta single (manzana, plátano) NO son
// intercambio fruta-por-fruta. Hugo: la fruta funciona "fruta por fruta".
const FRUIT_MIX = /(macedonia|multifruta|multi fruta|(dos|tres|cuatro|cinco|seis) frutas|fruta variada|frutas variadas|c[oó]ctel de frutas|mezcla de frutas|frutas del bosque|tutti|pur[eé] de frutas|compota|frutas en almibar|almíbar|fruta troceada variada)/i;

const db = JSON.parse(fs.readFileSync(DB, "utf8"));

const targets = db.filter((f) => {
  if (f.category !== "carbs") return false;
  if (f.clean_carb !== true) return false;
  const n = f.name || "";
  return DRINK.test(n) || SWEET_MIX.test(n) || FRUIT_MIX.test(n) || BABY_PROCESSED.test(n);
});

let changed = 0;
const log = [];
for (const f of targets) {
  if (f.clean_carb_prev === undefined) f.clean_carb_prev = f.clean_carb;
  f.clean_carb = false;
  changed++;
  log.push(`  ${(f.subgroup || "?").padEnd(8)} ${f.name}`);
}

console.log(`Ruido carb (bebidas + mezclas dulces) clean_carb→false: ${targets.length}`);
console.log(log.join("\n"));
console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"} — ${changed} registros`);

if (APPLY && changed) {
  fs.copyFileSync(DB, DB + ".precarb.bak");
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
  console.log(`Escrito database.json (backup: database.json.precarb.bak)`);
}
