"use strict";

const assert = require("assert");
const { curateProduct } = require("./curate_off_spain");

function base(overrides = {}) {
  return {
    code: "8480000000001",
    product_name_es: "Yogur natural",
    lc: "es",
    countries_tags: ["en:spain"],
    stores_tags: ["mercadona"],
    brands: "Hacendado",
    completeness: 0.8,
    data_quality_errors_tags: [],
    data_quality_bugs_tags: [],
    data_quality_warnings_tags: [],
    nova_group: 1,
    ingredients_text_es: "Leche, fermentos lácticos",
    nutriments: {
      "energy-kcal_100g": 62,
      proteins_100g: 4.1,
      carbohydrates_100g: 4.6,
      fat_100g: 3.0,
    },
    ...overrides,
  };
}

const eligible = curateProduct(base());
assert.strictEqual(eligible.eligible, true);
assert.strictEqual(eligible.record.retailer, "mercadona");
assert.strictEqual(eligible.record.provenance.market, "ES");
assert.strictEqual(eligible.record.name, "Yogur natural");
assert.strictEqual(eligible.record.processing.nova_group, 1);
assert.strictEqual(eligible.record.recommended_scope, "scope_policy_review");

assert.deepStrictEqual(
  curateProduct(base({ countries_tags: ["en:france"], countries: "France" })).reason,
  "no_spain_market_evidence",
);

assert.deepStrictEqual(
  curateProduct(base({ stores_tags: ["auchan"], brands: "Marca X" })).reason,
  "retailer_out_of_scope",
);

assert.deepStrictEqual(
  curateProduct(
    base({
      product_name_es: "",
      generic_name_es: "",
      product_name: "Yaourt nature",
      lc: "fr",
    }),
  ).reason,
  "no_spanish_name",
);

assert.deepStrictEqual(
  curateProduct(base({ nutriments: { "energy-kcal_100g": 62 } })).reason,
  "incomplete_or_invalid_macros",
);

assert.deepStrictEqual(
  curateProduct(base({ data_quality_errors_tags: ["en:energy-value-in-kcal-does-not-match"] })).reason,
  "off_quality_error",
);

const aldi = curateProduct(
  base({
    code: "8480000000002",
    product_name_es: "Copos de avena",
    stores_tags: ["aldi"],
    brands: "Gut Bio",
  }),
);
assert.strictEqual(aldi.eligible, true);
assert.strictEqual(aldi.record.retailer, "aldi");

for (const rejected of [
  base({
    code: "8480000000010",
    product_name_es: "Yatekomo fideos orientales",
    nova_group: 4,
  }),
  base({
    code: "8480000000011",
    product_name_es: "Avecrem caldo de pollo",
    nova_group: 3,
  }),
  base({
    code: "8480000000013",
    product_name_es: "Yogur de fresa",
    nova_group: 3,
    ingredients_text_es: "Leche, azúcar, fresa, fermentos lácticos",
  }),
  base({
    code: "8480000000014",
    product_name_es: "Refresco de naranja",
    nova_group: 3,
  }),
  base({
    code: "8480000000015",
    product_name_es: "Salchichón extra",
    nova_group: 3,
  }),
  base({
    code: "8480000000016",
    product_name_es: "Stuffed vine leaves with dill and mint",
    nova_group: 3,
  }),
  base({
    code: "8480000000017",
    product_name_es: "Lomo embuchado",
    nova_group: 3,
  }),
  base({
    code: "8480000000018",
    product_name_es: "Cacahuetes garrapiñados",
    nova_group: 3,
    ingredients_text_es: "Cacahuetes, azúcar",
  }),
]) {
  assert.strictEqual(
    curateProduct(rejected).eligible,
    false,
    `${rejected.product_name_es} no debe entrar en la cola española`,
  );
}

const nova4Natural = curateProduct(base({
  code: "8480000000012",
  product_name_es: "Yogur natural 0%",
  nova_group: 4,
  ingredients_text_es: "Leche desnatada, proteínas de leche, fermentos lácticos",
}));
assert.strictEqual(nova4Natural.eligible, true);
assert.strictEqual(nova4Natural.record.recommended_scope, "manual_review");
assert(
  nova4Natural.record.processing.review_reasons.includes("nova_group_4"),
);

const flavoredWithSweeteners = curateProduct(base({
  code: "8480000000019",
  product_name_es: "Yogur proteico sabor fresa",
  nova_group: 4,
  ingredients_text_es:
    "Leche desnatada, fresa, proteínas de leche, sucralosa, fermentos lácticos",
  ingredients_analysis_tags: ["en:contains-sweeteners"],
  additives_tags: ["en:e-955"],
}));
assert.strictEqual(flavoredWithSweeteners.eligible, true);
assert.strictEqual(
  flavoredWithSweeteners.record.recommended_scope,
  "manual_review",
);
assert.strictEqual(
  flavoredWithSweeteners.record.processing.contains_sweeteners,
  true,
);
assert(
  flavoredWithSweeteners.record.processing.review_reasons.includes(
    "flavored_dairy",
  ),
);

const unknownProcessing = curateProduct(base({
  code: "8480000000020",
  product_name_es: "Garbanzos cocidos",
  nova_group: null,
  ingredients_text_es: "",
}));
assert.strictEqual(unknownProcessing.eligible, true);
assert.strictEqual(unknownProcessing.record.recommended_scope, "manual_review");

console.log(
  "PASS: curador OFF España filtra azúcar y familias industriales; NOVA 4 y edulcorantes pasan a revisión explicable",
);
