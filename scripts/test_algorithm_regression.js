"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  ROOT,
  createEngine,
  calculateCase,
  normalize,
} = require("./lib/algorithm_harness");

const SPEC_PATH = path.join(
  ROOT,
  "..",
  "ESPECIFICACION_CASOS_DORADOS_INTERCAMBIADOR_V2.json",
);
const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
const ORIGIN_OVERRIDES = {
  avena_copos_40: "off_895cd31059",
  pan_integral_60: "bedca_0586",
  tempeh_100: "manual_tempeh",
  merluza_150: "bedca_0077",
  picada_pavo_120: "bedca_0034",
  atun_aceite_80: "bedca_0132",
};

function top(result, block = "intercambios") {
  return (result[block] || []).slice(0, 8);
}

function names(foods) {
  return foods.map((food) => normalize(food.name));
}

function count(foods, predicate) {
  return foods.filter(predicate).length;
}

function text(food) {
  return normalize(
    `${food.name || ""} ${food.label_reason || ""}`,
  );
}

function assertGlobalSafety(testCase, origin, result, engine) {
  const visible = [
    ...top(result, "intercambios"),
    ...top(result, "familia"),
    ...top(result, "preparados"),
  ];
  for (const food of visible) {
    assert(food.subgroup, `${testCase.id}: alimento sin subgroup: ${food.name}`);
    assert(
      food.quality_status !== "quarantine",
      `${testCase.id}: alimento en cuarentena visible: ${food.name}`,
    );
    assert(
      !(food.flags || []).includes("hidden") &&
        !(food.flags || []).includes("condiment"),
      `${testCase.id}: alimento oculto/condimento visible: ${food.name}`,
    );
    assert(
      Number.isFinite(food.equivalentAmount) &&
        food.equivalentAmount >= 5 &&
        food.equivalentAmount <= 600,
      `${testCase.id}: cantidad inválida para ${food.name}: ${food.equivalentAmount}`,
    );
    assert(
      engine.window.isPremiumExchangeCandidateEligible(food, origin),
      `${testCase.id}: candidato fuera del alcance 2.2: ${food.name}`,
    );
  }
}

function assertClinicalContract(id, result) {
  const foods = top(result);
  const topText = names(foods).join(" | ");

  switch (id) {
    case "avena_copos_40":
      assert(
        count(foods, (food) =>
          /\b(pasta|espiral|tagliatelle|macarr|spag|fideo|italpasta)\b/.test(text(food)),
        ) <= 2,
        `avena: demasiada pasta: ${topText}`,
      );
      assert(
        foods.every((food) =>
          !/\b(bolas de cereales|cereales solubles|cereales fibre|d style)\b/.test(text(food)),
        ),
        `avena: cereal industrial: ${topText}`,
      );
      break;

    case "pan_integral_60":
      // La interfaz muestra primero "otras marcas y formatos" para básicos
      // como el pan cuando hay al menos cinco. El contrato debe auditar ese
      // primer bloque real, además de las equivalencias entre familias.
      const breadOptions = [
        ...top(result, "familia"),
        ...foods,
      ];
      assert(
        count(breadOptions, (food) =>
          /\b(pan\w*|hogaza|rustic\w*|tostad\w*|biscot\w*|wrap|tortilla\w*|pita|baguet\w*|mollete\w*)\b/.test(text(food)),
        ) >= 5,
        `pan: faltan formatos de pan: ${names(breadOptions).join(" | ")}`,
      );
      assert(
        foods.every((food) =>
          !/\b(cereales fibre|cereales solubles|bolas de cereales|copos tostados)\b/.test(text(food)),
        ),
        `pan: cereal industrial: ${topText}`,
      );
      break;

    case "pechuga_pollo_100":
      assert(
        count(foods, (food) =>
          food.category === "protein" && food.clean_protein === true,
        ) >= 5,
        `pollo: faltan proteínas frescas: ${topText}`,
      );
      assert(
        foods.every((food) =>
          !/\b(fiambre|loncha|fajita|marinad|adobad|mortadela|salchicha|con salsa)\b/.test(text(food)),
        ),
        `pollo: preparado/fiambre en TOP8: ${topText}`,
      );
      break;

    case "tempeh_100":
      assert(
        count(foods, (food) =>
          food.subgroup === "plant_protein" ||
          (food.subgroup === "legumes" &&
            !/\b(sec[oa]s?|crud[oa]s?|requiere remojo|en grano)\b/.test(text(food))),
        ) >= 3,
        `tempeh: faltan vegetales prácticos: ${topText}`,
      );
      assert(
        foods.every((food) =>
          ["plant_protein", "legumes"].includes(food.subgroup),
        ),
        `tempeh: candidato no vegetal: ${topText}`,
      );
      break;

    case "chocolate_85_20": {
      const chocolateOptions = [...top(result, "familia"), ...foods];
      assert(
        chocolateOptions.length >= 1,
        "chocolate: debería conservar al menos un equivalente limpio",
      );
      assert(
        chocolateOptions.every((food) => /\b(chocolate|cacao|xocolata)\b/.test(text(food))),
        `chocolate: relleno con dulce no equivalente: ${topText}`,
      );
      break;
    }

    case "manzana_150":
      assert(
        foods.length >= 7 &&
        foods.every((food) =>
          food.category === "fruits" &&
          ["fruit", "tropical", "frutos_bosque"].includes(food.subgroup),
        ),
        `manzana: regresión: ${topText}`,
      );
      break;

    case "aguacate_100":
      assert(
        foods.length >= 7 &&
        foods.every((food) =>
          ["avocado", "other_fat", "nuts_seeds", "olive_oil"].includes(food.subgroup),
        ),
        `aguacate: grasa no limpia: ${topText}`,
      );
      assert(
        foods.every((food) =>
          !/\b(mayonesa|margarina|bacon|pate|sobrasada|alioli)\b/.test(text(food)),
        ),
        `aguacate: salsa/embutido: ${topText}`,
      );
      break;

    case "nueces_20":
      assert(
        count(foods, (food) => food.subgroup === "nuts_seeds") >= 7,
        `nueces: faltan frutos secos/semillas: ${topText}`,
      );
      break;

    case "queso_semicurado_30":
      assert(
        count(foods, (food) => food.subgroup === "aged_cheese") >= 7,
        `queso: mezcla de subfamilias: ${topText}`,
      );
      break;

    case "yogur_natural_125":
      assert(
        foods.length >= 7 &&
        foods.every((food) =>
          food.category === "dairy" &&
          ["whole_dairy", "low_fat_dairy", "high_protein_dairy"].includes(food.subgroup),
        ),
        `yogur: subfamilia incorrecta: ${topText}`,
      );
      assert(
        foods.every((food) =>
          !/\b(natilla|flan|fresa|chocolate|vainilla|batido)\b/.test(text(food)),
        ),
        `yogur: saborizado/postre: ${topText}`,
      );
      break;

    case "merluza_150":
      assert(
        count(foods, (food) => food.subgroup === "fish_white") >= 5,
        `merluza: faltan pescados blancos: ${topText}`,
      );
      assert(
        foods.every((food) =>
          !/\b(ensalada|nugget|rebozad|empanad|con salsa|surimi)\b/.test(text(food)),
        ),
        `merluza: preparado: ${topText}`,
      );
      break;

    case "salmon_120":
      assert(
        count(foods, (food) => food.subgroup === "fish_fatty") >= 5,
        `salmón: faltan pescados grasos: ${topText}`,
      );
      assert(
        foods.every((food) =>
          !/\b(chorizo|salchicha|bacon|mortadela)\b/.test(text(food)),
        ),
        `salmón: carne procesada: ${topText}`,
      );
      break;

    case "pasta_integral_50":
    case "arroz_crudo_50":
      assert(
        count(foods, (food) =>
          food.category === "carbs" &&
          ["grains", "tubers"].includes(food.subgroup),
        ) >= 6,
        `${id}: faltan hidratos base: ${topText}`,
      );
      assert(
        foods.every((food) =>
          !/\b(galleta|cookie|snack|cereal de desayuno|instant noodle)\b/.test(text(food)),
        ),
        `${id}: hidrato procesado: ${topText}`,
      );
      break;

    case "ternera_magra_120":
      assert(
        count(foods, (food) =>
          food.category === "protein" && food.clean_protein === true,
        ) >= 6,
        `ternera: faltan proteínas limpias: ${topText}`,
      );
      break;

    case "picada_pavo_120":
      assert(
        count(foods, (food) =>
          food.category === "protein" &&
          ["meat", "meat_lean", "meat_fatty"].includes(food.subgroup),
        ) >= 5,
        `pavo picado: faltan carnes frescas: ${topText}`,
      );
      assert(
        foods.every((food) =>
          !/\b(loncha|lascas|finissimas|brasead|fajita|fiambre|cocida|al horno)\b/.test(text(food)),
        ),
        `pavo picado: fiambre/preparado: ${topText}`,
      );
      break;

    case "huevo_100": {
      const family = top(result, "familia");
      assert(
        count(family, (food) => food.subgroup === "eggs") >= 3,
        `huevo: faltan formas de huevo en familia: ${names(family).join(" | ")}`,
      );
      break;
    }

    case "atun_aceite_80":
      assert(
        count(foods, (food) =>
          ["fish_fatty", "fish_white"].includes(food.subgroup),
        ) >= 6,
        `atún: faltan pescados equivalentes: ${topText}`,
      );
      break;

    case "leche_entera_200": {
      const family = top(result, "familia");
      assert(
        count(family, (food) => /\bleche\b/.test(normalize(food.name))) >= 6,
        `leche: faltan leches simples en familia: ${names(family).join(" | ")}`,
      );
      break;
    }

    case "garbanzos_cocidos_100":
      assert(
        count(foods, (food) =>
          food.subgroup === "legumes" &&
          !/\b(sec[oa]s?|crud[oa]s?|requiere remojo|en grano)\b/.test(text(food)),
        ) >= 6,
        `garbanzo: aparece peso seco o faltan cocidas: ${topText}`,
      );
      break;

    case "salmorejo_250":
      assert(
        result.noMatch || foods.length === 0 ||
        foods.every((food) => food.cold_soup === true),
        `salmorejo: se forzó un intercambio ajeno: ${topText}`,
      );
      break;

    default:
      throw new Error(`Caso sin contrato ejecutable: ${id}`);
  }
}

async function main() {
  const engine = createEngine();
  const outputs = new Map();

  for (const testCase of spec.cases) {
    const executableCase = {
      ...testCase,
      origin_id: ORIGIN_OVERRIDES[testCase.id],
    };
    const output = await calculateCase(engine, executableCase);
    outputs.set(testCase.id, output);
    assertGlobalSafety(testCase, output.origin, output.result, engine);
    assertClinicalContract(testCase.id, output.result);
  }

  assert.strictEqual(
    outputs.size,
    spec.cases.length,
    "No se ejecutaron todos los casos dorados",
  );
  console.log(
    `PASS: ${outputs.size} casos dorados ejecutados sobre js/algorithm.js real`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
