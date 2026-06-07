#!/usr/bin/env node
/**
 * reclassify_cold_soup.js — Hugo audit (Feedback Elena), Bloque 5.
 *
 * Gazpacho y salmorejo estaban en buckets mezclados (vegetables/other,
 * other/other, fruit/carbs) → matcheaban encurtidos, salteados, crema de
 * setas, tumaca, cream cheese, té/café con leche. Hugo: "alternativas de
 * misma lógica culinaria o, si no existen, no forzar intercambios absurdos".
 *
 * Hay 17 sopas frías reales en la base → forman familia propia. Fix:
 * subgroup="cold_soup", category="vegetables", flag cold_soup:true. El gate
 * en algorithm.js limita los intercambios al propio cluster (gazpacho ↔
 * gazpacho/salmorejo). Si tras el match calórico no queda nada → noMatch
 * (el front muestra "no hay intercambio equivalente") en vez de basura.
 *
 * Idempotente. Guarda subgroup_prev/category_prev.
 *
 * Uso: node scripts/reclassify_cold_soup.js [--apply]
 */
const fs = require("fs");
const path = require("path");

const DB = path.join(__dirname, "..", "database.json");
const APPLY = process.argv.includes("--apply");

const COLD_SOUP = /(gazpacho|gaspacho|salmorejo|ajoblanco|ajo blanco|vichyssoise)/i;

const db = JSON.parse(fs.readFileSync(DB, "utf8"));
const targets = db.filter((f) => COLD_SOUP.test(f.name || ""));

let changed = 0;
const log = [];
for (const f of targets) {
  const before = `${f.subgroup}/${f.category}`;
  if (f.subgroup_prev === undefined) f.subgroup_prev = f.subgroup || null;
  if (f.category_prev === undefined) f.category_prev = f.category || null;
  f.subgroup = "cold_soup";
  f.category = "vegetables";
  f.cold_soup = true;
  changed++;
  log.push(`  ${before.padEnd(18)} -> cold_soup/vegetables   ${f.name}`);
}

console.log(`Sopas frías (gazpacho/salmorejo/ajoblanco): ${targets.length}`);
console.log(log.join("\n"));
console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"} — ${changed} registros`);

if (APPLY && changed) {
  fs.copyFileSync(DB, DB + ".presoup.bak");
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
  console.log(`Escrito database.json (backup: database.json.presoup.bak)`);
}
