"use strict";

/**
 * Premium 2.3 systemic regression gate.
 *
 * These checks model the language and decisions of a woman using the tool in
 * Spain. They deliberately cover failures that the original 100-case nutrition
 * matrix did not detect: plural searches, common aliases, culinary form,
 * spoonable dairy, plant spreads and trusted BEDCA identities.
 */

const assert = require("assert");
const vm = require("vm");
const { createEngine, normalize } = require("./lib/algorithm_harness");

const COMMON_SEARCHES = [
  "avena", "copos de avena", "pan integral", "panes integrales", "arroz",
  "arroces", "pasta", "espaguetis", "macarrones", "patata", "patatas",
  "boniato", "quinoa", "cuscús", "tortilla de trigo", "tortillas de trigo",
  "pollo", "pechuga de pollo", "pavo", "ternera", "cerdo", "lomo de cerdo",
  "carne picada", "carnes picadas", "huevo", "huevos", "tortilla francesa",
  "merluza", "bacalao", "salmón", "sardina", "sardinas", "atún", "caballa",
  "dorada", "lubina", "trucha", "rodaballo", "gambón", "gambones", "gambas",
  "langostinos", "mejillones", "almejas", "pulpo", "calamar", "tofu", "tempeh",
  "seitán", "garbanzo", "garbanzos", "lenteja", "lentejas", "alubia",
  "alubias", "judías", "edamame", "leche", "leche semidesnatada", "yogur",
  "yogures", "kéfir", "skyr", "queso fresco", "queso de Burgos",
  "queso fresco batido", "mozzarella", "requesón", "queso cottage", "quark",
  "queso manchego", "manzana", "manzanas", "pera", "peras", "plátano",
  "plátanos", "naranja", "naranjas", "mandarina", "mandarinas", "fresa",
  "fresas", "kiwi", "kiwis", "uva", "uvas", "melón", "melones", "sandía",
  "sandías", "piña", "piñas", "mango", "mangos", "melocotón", "melocotones",
  "arándano", "arándanos", "cereza", "cerezas", "aguacate", "aguacates",
  "tomate", "tomates", "calabacín", "calabacines", "berenjena", "berenjenas",
  "pepino", "pepinos", "pimiento", "pimientos", "zanahoria", "zanahorias",
  "lechuga", "lechugas", "espinaca", "espinacas", "acelga", "acelgas",
  "brócoli", "brócolis", "coliflor", "coliflores", "repollo", "lombarda",
  "rúcula", "endibia", "espárragos", "alcachofas", "judías verdes",
  "champiñones", "cebollas", "ajos", "puerros", "calabazas", "nuez", "nueces",
  "almendra", "almendras", "avellana", "avellanas", "pistacho", "pistachos",
  "anacardo", "anacardos", "cacahuete", "cacahuetes", "chía", "semillas",
  "aceite de oliva", "aceites de oliva", "aceituna", "aceitunas",
  "crema de cacahuete", "tahini", "hummus", "guacamole",
];

const SEARCH_EQUIVALENCE_PAIRS = [
  ["nuez", "nueces"],
  ["almendra", "almendras"],
  ["avellana", "avellanas"],
  ["pistacho", "pistachos"],
  ["aceituna", "aceitunas"],
  ["manzana", "manzanas"],
  ["pera", "peras"],
  ["plátano", "plátanos"],
  ["naranja", "naranjas"],
  ["fresa", "fresas"],
  ["huevo", "huevos"],
  ["garbanzo", "garbanzos"],
];

function visible(food, engine) {
  return Boolean(
    food &&
      food.quality_status !== "quarantine" &&
      !(food.flags || []).includes("hidden") &&
      (
        typeof engine.window.isPremiumExchangeSearchable !== "function" ||
        engine.window.isPremiumExchangeSearchable(food)
      ),
  );
}

function resultNames(result) {
  return [
    ...result.intercambios,
    ...result.familia,
    ...result.preparados,
  ].map((food) => normalize(food.name));
}

async function main() {
  const engine = createEngine();
  const search = vm.runInContext("getLocalSearchResults", engine.context);

  assert(
    COMMON_SEARCHES.length >= 150,
    "La matriz de lenguaje cotidiano debe conservar al menos 150 búsquedas",
  );
  for (const query of COMMON_SEARCHES) {
    const results = search(query);
    assert(
      results.length > 0,
      `Búsqueda cotidiana sin resultados: "${query}"`,
    );
    assert(
      results.every((food) => visible(food, engine)),
      `Búsqueda con alimento no publicable: "${query}"`,
    );
  }

  for (const [singular, plural] of SEARCH_EQUIVALENCE_PAIRS) {
    const singularIds = new Set(search(singular).map((food) => String(food.id)));
    const pluralIds = new Set(search(plural).map((food) => String(food.id)));
    const shared = Array.from(singularIds).filter((id) => pluralIds.has(id));
    assert(
      shared.length > 0,
      `Singular y plural no recuperan ningún alimento común: ${singular}/${plural}`,
    );
  }

  const qfbResults = search("queso fresco batido");
  assert(qfbResults.length >= 3, "Queso fresco batido debe tener oferta real");
  assert(
    qfbResults.some((food) => String(food.id) === "off_9725c3eb72"),
    "Debe aparecer el queso fresco batido 0% verificado",
  );
  assert(
    qfbResults.every(
      (food) =>
        engine.window.inferPremiumContext(food) === "spoonable_fresh_dairy",
    ),
    "Queso fresco batido no puede clasificarse como refresco ni queso sólido",
  );

  const burgos = engine.foods.find((food) => food.id === "bedca_0064");
  assert(burgos && visible(burgos, engine), "Falta el queso de Burgos canónico");
  const burgosPrompt = engine.window.getPremiumUsagePrompt(
    burgos,
    engine.foods,
  );
  if (burgosPrompt) {
    assert(
      !burgosPrompt.options.some((option) => option.id === "spread"),
      "Un queso de Burgos sólido no debe preguntar si se va a untar",
    );
  }
  const burgosResult = await engine.calculate(burgos, 100, {
    usageMode: "any",
  });
  assert(
    resultNames(burgosResult)
      .slice(0, 30)
      .some((name) => name.includes("queso fresco batido")),
    "Burgos debe ofrecer queso fresco batido como alternativa secundaria útil",
  );

  const tortilla = engine.foods.find((food) => food.id === "bedca_0717");
  assert(
    tortilla && visible(tortilla, engine),
    "La tortilla francesa BEDCA debe ser buscable",
  );
  assert(
    search("tortilla francesa").some((food) => food.id === tortilla.id),
    "La búsqueda habitual «tortilla francesa» debe localizar BEDCA",
  );

  const gambon = engine.foods.find((food) => food.id === "off_f245010bbc");
  assert.strictEqual(
    engine.window.inferPremiumContext(gambon),
    "seafood",
    "El gambón debe clasificarse como marisco",
  );

  const blood = engine.foods.find((food) => food.id === "off_ed5f86a0ff");
  assert(
    !visible(blood, engine),
    "La sangre de pollo no puede competir con pechuga o carne cotidiana",
  );

  const cornFlakes = engine.foods.find((food) => food.id === "off_5033169db3");
  assert(cornFlakes, "Faltan los copos de maíz de la matriz Premium");
  const cornPrompt = engine.window.getPremiumUsagePrompt(
    cornFlakes,
    engine.foods,
  );
  assert(
    !cornPrompt || cornPrompt.id !== "oats_use",
    "Los copos de maíz no deben recibir una pregunta redactada para avena",
  );

  const hummus = engine.foods.find((food) => food.id === "off_2116da2b0f");
  assert(hummus && visible(hummus, engine), "Falta el hummus español canónico");
  const hummusResult = await engine.calculate(hummus, 50);
  const hummusNames = resultNames(hummusResult);
  assert(
    hummusNames.length >= 3,
    "El hummus habitual debe tener alternativas vegetales útiles",
  );
  assert(
    hummusNames.every(
      (name) => !/\b(sobrasada|zurrapa|pate|foie)\b/.test(name),
    ),
    "Un untable vegetal no puede recomendar untables cárnicos",
  );
  assert(
    hummusNames.every(
      (name) =>
        !/\b(crema|mantequilla|pasta) de (almendra|cacahuete|avellana)\b/.test(
          name,
        ),
    ),
    "El hummus no debe recomendar cremas de frutos secos de perfil dulce",
  );
  assert(
    hummusNames.some((name) => /\b(aguacate|guacamole)\b/.test(name)),
    "El hummus debe ofrecer aguacate o guacamole como alternativa salada secundaria",
  );

  const foreignOilIds = new Set(["off_09a6a8571e", "off_2bf4da0205"]);
  const oilResults = search("aceite de oliva").slice(0, 10);
  assert(
    oilResults.every(
      (food) =>
        !foreignOilIds.has(String(food.id)) ||
        /^aceite de oliva\b/i.test(String(food.name || "")),
    ),
    "Los aceites activos deben tener un nombre comprensible en español",
  );

  console.log(
    `PASS Premium 2.3 systemic: ${COMMON_SEARCHES.length} búsquedas cotidianas, ` +
      `${SEARCH_EQUIVALENCE_PAIRS.length} pares singular/plural y contextos críticos`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
