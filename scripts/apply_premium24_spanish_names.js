"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT } = require("./lib/algorithm_harness");

const DB_PATH = path.join(ROOT, "database.json");
const EXACT_TRANSLATIONS = {
  "Yogurt natural": "Yogur natural",
  "Yogurt Natural Linea 0%": "Yogur natural línea 0%",
  "Yogurt Natural Sin Lactosa": "Yogur natural sin lactosa",
  "Olives vertes dénoyautées": "Aceitunas verdes sin hueso",
  "Olives avec noyau": "Aceitunas con hueso",
  Houmous: "Hummus",
  "Kefir naturalny": "Kéfir natural",
  "Quefir natural": "Kéfir natural",
  "Quefir d'ovella amb nabius ecologic":
    "Kéfir ecológico de oveja con arándanos",
  "Beguda de soja": "Bebida de soja",
  "Macarrons vegetals": "Macarrones vegetales",
  "Espirals vegetals": "Espirales vegetales",
  "Macarrons eco": "Macarrones ecológicos",
  "Noix de macadamia": "Nueces de macadamia",
  "Olives amb pinyol àlora": "Aceitunas estilo Álora con hueso",
  "Olives amb pinyol adobades": "Aceitunas aliñadas con hueso",
  "Olives sense pinyol manzanilla": "Aceitunas manzanilla sin hueso",
  "Olives amb pinyol Gaspatxes": "Aceitunas gazpachas con hueso",
  "Olives farcides d'anxova": "Aceitunas rellenas de anchoa",
  Olives: "Aceitunas",
  "Olives negres sense pinyol": "Aceitunas negras sin hueso",
  "Olive verte avec anchois": "Aceituna verde con anchoa",
  "Gaspacho suave": "Gazpacho suave",
};

function main() {
  const foods = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const changed = [];
  for (const food of foods) {
    let nextName = EXACT_TRANSLATIONS[food.name] || food.name;
    nextName = String(nextName || "")
      .replace(/&quot;/gi, '"')
      .replace(/&amp;/gi, "&")
      .replace(/\bparte s\/e\b/gi, "corte no especificado")
      .replace(/\bparte sin especificar\b/gi, "corte no especificado")
      .replace(/\bs\/h\b/gi, "sin hueso");
    if (nextName === food.name) continue;
    if (!food.original_name) food.original_name = food.name;
    changed.push({ id: food.id, from: food.name, to: nextName });
    food.name = nextName;
    food.quality_reasons = Array.from(
      new Set([
        ...(food.quality_reasons || []),
        "premium_2_4_spanish_display_name",
      ]),
    );
  }
  fs.writeFileSync(DB_PATH, `${JSON.stringify(foods, null, 2)}\n`);
  console.log(JSON.stringify({ changed: changed.length, examples: changed }, null, 2));
}

main();
