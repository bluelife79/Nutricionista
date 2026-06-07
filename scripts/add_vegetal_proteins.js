#!/usr/bin/env node
/**
 * add_vegetal_proteins.js — Hugo audit (Feedback Elena), Bloque 1.
 *
 * Hugo: "tempeh ni aparece en búsqueda". No existían en database.json.
 * Se agregan tempeh y soja texturizada como proteína vegetal (plant_protein),
 * con clean_protein:true para que entren al cluster vegetal y reciban el
 * fallback de legumbres ya implementado en calculateEquivalence.
 *
 * Valores nutricionales por 100g (fuentes estándar BEDCA/USDA):
 *   - Tempeh: 192 kcal, P 20.3, C 7.6, F 10.8
 *   - Soja texturizada (seca): 340 kcal, P 52, C 30, F 1.5
 *
 * Idempotente: no duplica si ya existen (match por id).
 *
 * Uso: node scripts/add_vegetal_proteins.js [--apply]
 */
const fs = require("fs");
const path = require("path");

const DB = path.join(__dirname, "..", "database.json");
const APPLY = process.argv.includes("--apply");

const NEW = [
  {
    source: "BEDCA",
    name: "Tempeh",
    protein: 20.3, carbs: 7.6, fat: 10.8, calories: 192,
    category: "protein",
    brand: "Marca Blanca",
    id: "manual_tempeh",
    code: null, quantity: null,
    subgroup: "plant_protein",
    macro_profile: "protein",
    flags: [],
    ready_to_eat: false,
    raw_ingredient: false,
    meal_slot: "comida",
    frequency: "ocasional",
    exotic: false,
    label_confidence: 95,
    label_reason: "Proteína vegetal fermentada de soja",
    usage_es: "Derivado fermentado de soja, rico en proteína. Salteado o a la plancha en comida o cena. Intercambio con tofu, seitán o legumbres.",
    culinary_role: "meal_dish",
    clean_protein: true,
  },
  {
    source: "BEDCA",
    name: "Soja texturizada",
    protein: 52, carbs: 30, fat: 1.5, calories: 340,
    category: "protein",
    brand: "Marca Blanca",
    id: "manual_soja_texturizada",
    code: null, quantity: null,
    subgroup: "plant_protein",
    macro_profile: "protein",
    flags: [],
    ready_to_eat: false,
    raw_ingredient: false,
    meal_slot: "comida",
    frequency: "ocasional",
    exotic: false,
    label_confidence: 95,
    label_reason: "Proteína vegetal de soja deshidratada",
    usage_es: "Proteína de soja deshidratada, se hidrata antes de cocinar. Base de boloñesas y guisos vegetales. Intercambio con tofu, tempeh o legumbres.",
    culinary_role: "meal_dish",
    clean_protein: true,
  },
];

const db = JSON.parse(fs.readFileSync(DB, "utf8"));
const existing = new Set(db.map((f) => f.id));
const toAdd = NEW.filter((f) => !existing.has(f.id));

console.log(`Nuevos a agregar: ${toAdd.length}`);
toAdd.forEach((f) => console.log(`  + ${f.name} [${f.subgroup}/${f.category}] ${f.calories}kcal`));

if (APPLY && toAdd.length) {
  fs.copyFileSync(DB, DB + ".prevveg.bak");
  db.push(...toAdd);
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
  console.log(`Escrito database.json (+${toAdd.length}, backup: database.json.prevveg.bak)`);
} else {
  console.log("DRY-RUN");
}
