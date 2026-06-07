#!/usr/bin/env node
/**
 * fix_clean_fat_gaps.js — Hugo audit (Feedback Elena), ajuste grasas limpias.
 *
 * "Aceite de oliva" traía "Margarina de maíz" al rank 1: la margarina estaba
 * en subgroup other_fat con clean_fat=undefined, y el gate clean_fat sólo
 * excluye con ===false → la margarina (y otros fats sin flag) se colaban.
 *
 * Fix: poblar clean_fat en TODOS los fat sin flag. Limpios (aceites puros,
 * aguacate, frutos secos, aceitunas) → true; el resto (margarina, manteca,
 * salsas, procesados) → false. Idempotente (solo toca undefined).
 *
 * Uso: node scripts/fix_clean_fat_gaps.js [--apply]
 */
const fs = require("fs");
const path = require("path");
const DB = path.join(__dirname, "..", "database.json");
const APPLY = process.argv.includes("--apply");

// Cremas de frutos secos puras = limpias (Hugo aprobó "crema de cacahuete").
const CREMA_LIMPIA = /crema de (almendr|caca?huete|anacardo|avellana|frutos secos|pistacho)/i;
// Nut/grasa pura = el nombre EMPIEZA con el alimento limpio (evita
// "Plum cake nueces", "Conos de vainilla con nueces", "Danacol Nueces").
const PURE_FAT = /^(pi[ñn]ones?|almendras?|nueces|nuez|avellanas?|pistachos?|anacardos?|cacahuetes?|macadamia|pipas?|semillas?|aceite de (oliva|girasol|lino|nuez|aguacate|coco|s[eé]samo|colza)|aceitunas?|aguacate)\b/i;
const DIRTY_NAME = /(margarina|manteca|mantequilla|salsa|mayonesa|alioli|all i oli|paté|pat[eé]|sobrasada|mortadela|foie|nata|chocolate|dulce)/i;

const db = JSON.parse(fs.readFileSync(DB, "utf8"));
const targets = db.filter((f) => f.category === "fat" && f.clean_fat === undefined);

let t = 0, fl = 0;
for (const f of targets) {
  const n = f.name || "";
  let clean;
  if (CREMA_LIMPIA.test(n)) clean = true;
  else if (DIRTY_NAME.test(n)) clean = false;
  else if (PURE_FAT.test(n)) clean = true;
  else clean = false; // default conservador: si no es claramente limpio, no lo es
  f.clean_fat = clean;
  if (clean) t++; else fl++;
}
console.log(`fat sin clean_fat: ${targets.length} → true:${t} false:${fl}`);
targets.forEach((f) => console.log(`  clean_fat=${f.clean_fat}  [${f.subgroup}] ${f.name}`));
if (APPLY && targets.length) {
  fs.copyFileSync(DB, DB + ".precleanfat.bak");
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
  console.log(`\n${"APPLIED"} — database.json escrito (backup .precleanfat.bak)`);
} else console.log("\nDRY-RUN");
