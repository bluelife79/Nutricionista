"use strict";

const assert = require("assert");
const matrix = require("./contextual_matrix.json");
const {
  createEngine,
  normalize,
} = require("./lib/algorithm_harness");

const PREPARED_RE =
  /\b(parrillad|menestra|mix de|mezcla de|trio de|riojana|jardinera|falafel|hummus|con verduras|con setas|veloute|lasan|tortelloni|paella|risotto)\b/;
const FLAVORED_DAIRY_RE =
  /\b(fresa|strawberr|erdbeer|frambues|raspberr|melocoton|peach|vainilla|vanilla|vanille|arandano|blueberr|myrtil|heidelbeer|chocolat|cioccolat|stracc|stratac|tropical|maracuya|passion|flavour)\w*/;
const NON_FERMENTED_PROTEIC_DAIRY_RE =
  /\b(cottage|queso|quark|requeson|fromage|mousse|natilla|pudin|pudding|flan|budino|gelatina|postre|snack)\b/;

function visible(food) {
  return food &&
    food.quality_status !== "quarantine" &&
    !(food.flags || []).includes("hidden") &&
    ["exchange_core", "reference_only"].includes(food.exchange_scope?.status) &&
    food.subgroup != null &&
    food.subgroup !== "" &&
    food.subgroup !== "?";
}

function sourceRank(food) {
  const source = normalize(food.source);
  if (source === "bedca") return 0;
  if (["mercadona", "carrefour", "dia", "eroski", "lidl", "alcampo"].includes(source)) {
    return 1;
  }
  return 2;
}

function findOrigin(foods, testCase) {
  if (testCase.origin_id) {
    return foods.find((food) => String(food.id) === String(testCase.origin_id));
  }
  const query = normalize(testCase.query);
  const exact = foods
    .filter((food) => visible(food) && normalize(food.name) === query)
    .sort((a, b) => sourceRank(a) - sourceRank(b));
  if (exact.length > 0) return exact[0];
  return foods
    .filter((food) => visible(food) && normalize(food.name).includes(query))
    .sort((a, b) =>
      normalize(a.name).length - normalize(b.name).length ||
      sourceRank(a) - sourceRank(b),
    )[0];
}

function top(result, block = "intercambios") {
  return (result[block] || []).slice(0, 8);
}

function names(items) {
  return items.map((food) => normalize(food.name));
}

function assertGeneric(testCase, result) {
  for (const block of ["intercambios", "familia", "preparados"]) {
    const ids = new Set();
    for (const food of result[block] || []) {
      assert(!ids.has(String(food.id)), `${testCase.id}: duplicado en ${block}: ${food.name}`);
      ids.add(String(food.id));
      assert(visible(food), `${testCase.id}: alimento no publicable: ${food.name}`);
      assert(
        Number.isFinite(food.equivalentAmount) &&
          food.equivalentAmount >= 5 &&
          food.equivalentAmount <= 600,
        `${testCase.id}: cantidad inválida: ${food.name} ${food.equivalentAmount}`,
      );
      assert(
        !/\bdescatalogad/.test(normalize(food.name)),
        `${testCase.id}: producto descatalogado visible: ${food.name}`,
      );
      assert(
        Number(food.matchDisplay ?? food.matchScore) >= 0,
        `${testCase.id}: score inválido: ${food.name}`,
      );
    }
  }

  for (const food of top(result)) {
    assert(
      !PREPARED_RE.test(normalize(food.name)),
      `${testCase.id}: receta compuesta en intercambios: ${food.name}`,
    );
  }
}

function assertTargeted(testCase, origin, result) {
  const items = top(result);
  const itemNames = names(items);

  if (testCase.id === "patata") {
    assert(
      itemNames.every((name) => !/\b(arroz con verduras|trio de quinoa)\b/.test(name)),
      `patata: plato compuesto en TOP: ${itemNames.join(" | ")}`,
    );
  }

  if (testCase.id === "picada_pavo") {
    const sameFormat = top(result, "familia");
    assert(
      sameFormat.some((food) => /\bpicad\w*\b/.test(normalize(food.name))),
      `carne picada: falta una alternativa limpia del mismo formato: ${names(sameFormat).join(" | ")}`,
    );
    assert(
      items.slice(0, 5).every((food) =>
        ["meat", "meat_lean", "meat_fatty"].includes(food.subgroup),
      ),
      `carne picada: alternativas directas fuera de carnes frescas: ${itemNames.join(" | ")}`,
    );
  }

  if (testCase.id === "tofu") {
    assert(
      itemNames.every((name) =>
        !/\b(riojana|jardinera|falafel|hummus|con verduras)\b/.test(name),
      ),
      `tofu: receta preparada en TOP: ${itemNames.join(" | ")}`,
    );
    assert(
      items.slice(0, 3).every((food) => food.subgroup === "plant_protein"),
      `tofu: el TOP3 no prioriza proteína vegetal directa: ${itemNames.join(" | ")}`,
    );
  }

  if (testCase.id === "salmon") {
    assert(
      names(top(result, "familia")).every((name) => !/\bpreparado para\b/.test(name)),
      `salmón: preparado comercial en familia`,
    );
  }

  if (["leche_entera", "leche_desnatada"].includes(testCase.id)) {
    const visibleItems = [
      ...top(result, "intercambios"),
      ...top(result, "familia"),
    ];
    assert(
      names(visibleItems).every((name) => !/\blapte\b|\bgrasime\b/.test(name)),
      `${testCase.id}: etiqueta no localizada visible`,
    );
    assert(result.familia.length >= 5, `${testCase.id}: faltan leches simples`);
  }

  if (["yogur", "kefir", "skyr"].includes(testCase.id)) {
    assert(
      itemNames.every((name) => !FLAVORED_DAIRY_RE.test(name)),
      `${testCase.id}: lácteo saborizado para origen natural: ${itemNames.join(" | ")}`,
    );
    assert(
      itemNames.every((name) => !NON_FERMENTED_PROTEIC_DAIRY_RE.test(name)),
      `${testCase.id}: queso fresco o postre de cuchara para un fermentado: ${itemNames.join(" | ")}`,
    );
  }

  if (testCase.id === "mozzarella") {
    assert(result.familia.length >= 5, "mozzarella: faltan formatos de mozzarella");
    assert(result.intercambios.length >= 1, "mozzarella: falta al menos un intercambio honesto");
  }

  if (testCase.id === "pera") {
    assert.strictEqual(origin.category, "fruits", "pera: category incorrecta");
    assert.strictEqual(origin.subgroup, "fruit", "pera: subgroup incorrecto");
  }

  if (testCase.id === "brocoli") {
    assert(
      items.slice(0, 3).some((food) => food.subgroup === "cruciferous"),
      `brócoli: falta una crucífera culinariamente próxima en TOP3: ${itemNames.join(" | ")}`,
    );
    assert(
      itemNames.every((name) => !/\bparrillada\b/.test(name)),
      `brócoli: parrillada en intercambios reales`,
    );
  }

  if (testCase.id === "zanahoria") {
    const realAndFamily = [...top(result), ...top(result, "familia")];
    assert(
      names(realAndFamily).every((name) => !/\b(zumo|nectar|bebida)\b/.test(name)),
      `zanahoria: formato líquido tratado como alimento entero`,
    );
  }

  if (testCase.id === "chocolate") {
    const chocolateOptions = [...top(result, "familia"), ...items];
    assert(
      chocolateOptions.length >= 1 &&
      names(chocolateOptions).every((name) => /\b(chocolate|cacao|xocolata)\b/.test(name)),
      `chocolate: alternativa no equivalente: ${names(chocolateOptions).join(" | ")}`,
    );
  }

  if (testCase.id === "salmorejo") {
    assert(
      result.noMatch || result.intercambios.length === 0,
      "salmorejo: se forzó un intercambio real",
    );
    assert(
      (result.preparados || []).every((food) => food.cold_soup === true),
      "salmorejo: referencia preparada fuera del cluster de sopas frías",
    );
  }
}

async function main() {
  assert.strictEqual(matrix.length, 60, "La matriz contextual debe contener 60 casos");
  const engine = createEngine();
  const groupCounts = new Map();

  for (const testCase of matrix) {
    const origin = findOrigin(engine.foods, testCase);
    assert(origin, `${testCase.id}: no se encontró "${testCase.query}"`);
    assert(visible(origin), `${testCase.id}: el origen no es publicable`);
    const result = await engine.calculate(origin, testCase.amount_g);
    assertGeneric(testCase, result);
    assertTargeted(testCase, origin, result);
    groupCounts.set(testCase.group, (groupCounts.get(testCase.group) || 0) + 1);
  }

  const vegetarianEngine = createEngine();
  vegetarianEngine.window.DIETARY_FILTERS = new Set(["vegetarian"]);
  const chicken = vegetarianEngine.foods.find((food) => food.id === "off_400b81d4df");
  const vegetarianResult = await vegetarianEngine.calculate(chicken, 100);
  const vegetarianVisible = [
    ...top(vegetarianResult),
    ...top(vegetarianResult, "familia"),
  ];
  assert(vegetarianVisible.length > 0, "filtro vegetariano: resultado vacío inesperado");
  assert(
    vegetarianVisible.every((food) => vegetarianEngine.window.isVegetarian(food)),
    "filtro vegetariano: se coló carne o pescado",
  );

  const lactoseEngine = createEngine();
  lactoseEngine.window.DIETARY_FILTERS = new Set(["lactose_free"]);
  const naturalYogurt = lactoseEngine.foods.find((food) => food.id === "off_00932d34bc");
  const lactoseResult = await lactoseEngine.calculate(naturalYogurt, 125);
  const lactoseVisible = [
    ...top(lactoseResult),
    ...top(lactoseResult, "familia"),
  ];
  assert(lactoseVisible.length > 0, "filtro sin lactosa: resultado vacío inesperado");
  assert(
    lactoseVisible.every((food) => lactoseEngine.window.isLactoseFree(food)),
    "filtro sin lactosa: se coló un lácteo con lactosa",
  );

  console.log(
    `PASS: ${matrix.length} casos contextuales ` +
      `(${[...groupCounts].map(([group, count]) => `${group}=${count}`).join(", ")}), ` +
      `filtros vegetariano/sin lactosa`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
