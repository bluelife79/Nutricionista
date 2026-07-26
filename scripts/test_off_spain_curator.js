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

console.log("PASS: curador OFF España filtra mercado, tiendas, idioma, macros y calidad");
