#!/usr/bin/env node
/**
 * refine_dairy_subfamily.js — Hugo audit (Feedback Elena), Bloque 3 (lácteos).
 *
 * dairy_subfamily era demasiado grueso: `frescos_proteicos` (460) mezclaba
 * yogur + kéfir + skyr + queso fresco + ricotta + bebidas lácteas, y había
 * leche mal etiquetada. Resultado: yogur natural traía leche/bebidas, yogur
 * griego traía queso fresco/ricotta, leche traía quesos.
 *
 * Hugo: separar subfamilias —
 *   leche / yogur_kefir / queso_fresco / queso_curado / bebida_postre.
 *
 * Reasigna dairy_subfamily SOLO en category=dairy, por heurística de nombre,
 * con prioridad determinística (drink/postre primero para no clasificar
 * "batido de yogur" como yogur). Guarda dairy_subfamily_prev. Idempotente.
 *
 * Buckets destino:
 *   bebida_postre  — bebida láctea, batido, actimel, drink, smoothie, cacao,
 *                    natillas, flan, mousse, postre, café con leche, saborizado
 *   yogur_kefir    — yogur/yog/yaourt/greek yogurt, kéfir, skyr, bifidus, cuajada
 *   queso_fresco   — queso fresco, burgos, ricotta, requesón, mató, mozzarella,
 *                    cottage, quark, fromage frais/blanc, petit suisse, quark
 *   grasa_lactea   — nata, crema (de leche), mantequilla, mascarpone, mantequilla
 *   leche          — leche (no bebida/yogur/queso/postre)
 *   bebida_vegetal — bebida/leche vegetal (avena/soja/almendra/arroz/coco) [se respeta el existente]
 *   (resto)        — conserva su valor previo (quesos_solidos curados, postres_lacteos, basura no-dairy)
 *
 * Uso: node scripts/refine_dairy_subfamily.js [--apply]
 */
const fs = require("fs");
const path = require("path");

const DB = path.join(__dirname, "..", "database.json");
const APPLY = process.argv.includes("--apply");

const VEGETAL = /(bebida|leche)\s+(de\s+)?(avena|soja|almendra|arroz|coco|avellana|anacardo|nuez|nueces|c[aá][ñn]amo|espelta|quinoa|mijo)|vegetal drink|plant|veggie/i;
const DRINK_DESSERT = /(bebida l[aá]ctea|batido|\bdrink\b|smoothie|actimel|densia|l[ií]quido|para beber|bebible|caf[eé]|cacao|chocolate|natilla|flan|mousse|postre|crema inglesa|dulce de leche|arroz con leche|pan de leche|condensad|sabor\b|saborizad|aromatizad|edulcorad|vainilla|fresa|melocot[oó]n|c[ií]trico|lim[oó]n|con fruta|con cereales|con miel|con az[uú]car|con galleta)/i;
const YOGUR_KEFIR = /(yogur|yog  ?ur|yog[uú]r|yoghourt|yaourt|yogurt|greek yogurt|griego|k[eé]fir|skyr|b[ií]fidus|bifidus|leche fermentada|fermentad)/i;
const QUESO_FRESCO = /(queso fresco|fresco batido|burgos|ricotta|reques[oó]n|mat[oó]\b|mozzarella|mozarella|cottage|quark|fromage frais|fromage blanc|fromage light|petit suisse|petit-suisse|ch[eè]vre fresco|cheese fresh|fresh cheese|cuajada)/i;
const GRASA = /(\bnata\b|crema de leche|crema agria|sour cream|mantequilla|mantega|mascarpone|cr[eè]me fra[ií]che|clotted)/i;
const LECHE = /\blech?e\b|\bllet\b|\bmilk\b|lapte/i;

function classify(name) {
  const n = name || "";
  if (VEGETAL.test(n)) return "bebida_vegetal";
  if (DRINK_DESSERT.test(n)) return "bebida_postre";
  if (QUESO_FRESCO.test(n)) return "queso_fresco";
  if (YOGUR_KEFIR.test(n)) return "yogur_kefir";
  if (GRASA.test(n)) return "grasa_lactea";
  if (LECHE.test(n)) return "leche";
  return null; // sin match → conservar valor previo
}

const db = JSON.parse(fs.readFileSync(DB, "utf8"));
const dairy = db.filter((f) => f.category === "dairy");

let changed = 0;
const buckets = {};
for (const f of dairy) {
  const dest = classify(f.name);
  if (!dest) { buckets["(sin cambio)"] = (buckets["(sin cambio)"] || 0) + 1; continue; }
  buckets[dest] = (buckets[dest] || 0) + 1;
  if (f.dairy_subfamily !== dest) {
    if (f.dairy_subfamily_prev === undefined) f.dairy_subfamily_prev = f.dairy_subfamily || null;
    f.dairy_subfamily = dest;
    changed++;
  }
}

console.log("Distribución destino (dairy):");
for (const k of Object.keys(buckets).sort()) console.log(`  ${k.padEnd(16)} ${buckets[k]}`);
console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"} — ${changed} reasignados`);

// Muestras de control
const show = (q, dest) => {
  const sample = dairy.filter((f) => classify(f.name) === dest).slice(0, 8).map((f) => f.name);
  console.log(`\n[${dest}] muestra:\n  ` + sample.join("\n  "));
};
if (!APPLY) { ["leche", "yogur_kefir", "queso_fresco", "bebida_postre"].forEach((d) => show(null, d)); }

if (APPLY && changed) {
  fs.copyFileSync(DB, DB + ".predairy.bak");
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
  console.log(`\nEscrito database.json (backup: database.json.predairy.bak)`);
}
