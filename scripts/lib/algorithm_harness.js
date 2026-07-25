"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function loadJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function localFetch(resource) {
  const target = String(resource);
  if (target === "assets/embeddings.bin") {
    const bytes = fs.readFileSync(path.join(ROOT, target));
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    return Promise.resolve({
      ok: true,
      arrayBuffer: async () => arrayBuffer,
    });
  }
  if (target === "assets/embeddings_meta.json") {
    return Promise.resolve({
      ok: true,
      json: async () => loadJson(target),
    });
  }
  return Promise.resolve({
    ok: false,
    status: 404,
    arrayBuffer: async () => null,
    json: async () => ({}),
  });
}

function createEngine() {
  const foods = loadJson("database.json");
  if (!Array.isArray(foods)) {
    throw new Error("database.json debe ser un array plano de alimentos");
  }

  const silentConsole = {
    log() {},
    info() {},
    debug() {},
    warn() {},
    error() {},
  };
  const window = {
    foodsDatabase: foods,
    SEMANTIC_EMBEDDINGS_ENABLED: true,
    RERANK_ENABLED: false,
    LLM_JUDGE_ENABLED: false,
    DIETARY_FILTERS: new Set(),
    location: { search: "" },
  };
  const context = {
    window,
    foodsDatabase: foods,
    document: { querySelector: () => null },
    fetch: localFetch,
    console: silentConsole,
    AbortController,
    Int8Array,
    Map,
    Set,
    Promise,
    Date,
    Math,
    Number,
    String,
    Object,
    Array,
    JSON,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  };
  context.globalThis = context;
  vm.createContext(context);

  for (const file of [
    "js/exchange_groups.js",
    "js/dietary_filters.js",
    "js/algorithm.js",
  ]) {
    let source = fs.readFileSync(path.join(ROOT, file), "utf8");
    if (file === "js/algorithm.js") {
      const lines = source.split("\n");
      const filterStart = lines.findIndex((line) =>
        line.includes("const candidates = foodsDatabase.filter"),
      );
      const filterEnd = lines.findIndex((line) =>
        line.includes("const withEquivalence = candidates"),
      );
      if (filterStart >= 0 && filterEnd > filterStart) {
        for (let index = filterStart; index < filterEnd; index += 1) {
          lines[index] = lines[index].replace(
            "return false;",
            `return (window.__testRejects ||= []).push({ id: f.id, line: ${index + 1} }), false;`,
          );
        }
        source = lines.join("\n");
      }
      source = source.replace(
        "  const t1 = withEquivalence.filter((a) => a.tier === 1);",
        "  window.__testCandidates = candidates;\n" +
          "  window.__testWithEquivalence = withEquivalence;\n" +
          "  const t1 = withEquivalence.filter((a) => a.tier === 1);",
      );
      source = source.replace(
        "  // Group by semantic type using the existing tier field:",
        "  window.__testWithHybrid = withHybrid;\n\n" +
          "  // Group by semantic type using the existing tier field:",
      );
    }
    vm.runInContext(source, context, { filename: file });
  }

  const calculate = vm.runInContext("calculateAlternatives", context);
  return { foods, window, context, calculate };
}

function findFood(foods, query, aliases = []) {
  const terms = [query, ...aliases].map(normalize).filter(Boolean);
  for (const term of terms) {
    const exact = foods.filter((food) => normalize(food.name) === term);
    if (exact.length > 0) {
      return exact.sort((a, b) => {
        const sourceRank = (food) => {
          const source = normalize(food.source);
          if (source === "bedca") return 0;
          if (source === "mercadona") return 1;
          if (source === "carrefour") return 2;
          return 3;
        };
        return sourceRank(a) - sourceRank(b);
      })[0];
    }
  }
  for (const term of terms) {
    const hits = foods
      .filter((food) => normalize(food.name).includes(term))
      .sort((a, b) => normalize(a.name).length - normalize(b.name).length);
    if (hits.length > 0) return hits[0];
  }
  const stop = new Set(["de", "del", "la", "el", "los", "las", "en", "y"]);
  for (const term of terms) {
    const tokens = term.split(" ").filter((token) => token && !stop.has(token));
    const hits = foods
      .filter((food) => {
        const name = normalize(food.name);
        return tokens.length > 0 && tokens.every((token) => name.includes(token));
      })
      .sort((a, b) => normalize(a.name).length - normalize(b.name).length);
    if (hits.length > 0) return hits[0];
  }
  return null;
}

async function calculateCase(engine, testCase) {
  const origin = testCase.origin_id
    ? engine.foods.find((food) => food.id === testCase.origin_id)
    : findFood(engine.foods, testCase.query, testCase.aliases);
  if (!origin) {
    throw new Error(`No se encontró origen para "${testCase.query}"`);
  }
  const result = await engine.calculate(origin, testCase.amount_g);
  return { origin, result };
}

module.exports = {
  ROOT,
  normalize,
  createEngine,
  findFood,
  calculateCase,
};
