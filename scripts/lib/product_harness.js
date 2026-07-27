"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ROOT, createEngine } = require("./algorithm_harness");

const EXECUTABLE_FILES = [
  "database.json",
  "js/runtime_config.js",
  "js/exchange_groups.js",
  "js/dietary_filters.js",
  "js/premium_policy.js",
  "js/culinary_intent.js",
  "js/exchange_scope.js",
  "js/algorithm.js",
  "js/presentation_policy.js",
  "index.html",
  "version.json",
];

function sha256(relativePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(ROOT, relativePath)))
    .digest("hex");
}

function createProductHarness(options = {}) {
  const engine = createEngine(options);
  const search = vm.runInContext("getLocalSearchResults", engine.context);

  function usageModesFor(food) {
    const prompt =
      typeof engine.window.getPremiumUsagePrompt === "function"
        ? engine.window.getPremiumUsagePrompt(food, engine.foods)
        : null;
    const ids = prompt?.options?.map((option) => option.id).filter(Boolean) || [];
    return {
      prompt,
      modes: Array.from(new Set(["any", ...ids])),
    };
  }

  function visibleResults(food, result) {
    if (typeof engine.window.getInitiallyVisibleResults !== "function") {
      throw new Error("presentation_policy.js no expone el orden visual");
    }
    return engine.window.getInitiallyVisibleResults(food, result);
  }

  function expandableScrollOrder(food, result) {
    if (typeof engine.window.getExpandableScrollOrder !== "function") {
      throw new Error("presentation_policy.js no expone el orden desplegable");
    }
    return engine.window.getExpandableScrollOrder(food, result);
  }

  async function calculateFromQuery(query, amount, usageMode = "any") {
    const searchResults = search(query);
    if (searchResults.length === 0) {
      return {
        query,
        amount,
        usageMode,
        origin: null,
        searchResults,
        result: null,
        visible: [],
      };
    }
    const origin = searchResults[0];
    const result = await engine.calculate(origin, amount, { usageMode });
    return {
      query,
      amount,
      usageMode,
      origin,
      searchResults,
      result,
      visible: visibleResults(origin, result),
    };
  }

  return {
    ...engine,
    search,
    usageModesFor,
    visibleResults,
    expandableScrollOrder,
    calculateFromQuery,
    provenance: {
      release: JSON.parse(
        fs.readFileSync(path.join(ROOT, "version.json"), "utf8"),
      ),
      runtime: { ...engine.window.REVOLUCIONAT_RUNTIME_CONFIG },
      hashes: Object.fromEntries(
        EXECUTABLE_FILES.map((file) => [file, sha256(file)]),
      ),
    },
  };
}

module.exports = {
  EXECUTABLE_FILES,
  ROOT,
  createProductHarness,
  sha256,
};
