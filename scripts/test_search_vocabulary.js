"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ROOT, createEngine } = require("./lib/algorithm_harness");

function main() {
  const vocabulary = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "config", "search_vocabulary.json"),
      "utf8",
    ),
  );
  const queries = JSON.parse(
    fs.readFileSync(
      path.join(
        ROOT,
        "audit",
        "evidence",
        "v2_3_adversarial",
        "scripts",
        "queries.json",
      ),
      "utf8",
    ),
  );
  const indexSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const engine = createEngine();
  const search = vm.runInContext("getLocalSearchResults", engine.context);
  const feedback = vm.runInContext("getSearchFeedback", engine.context);

  assert(
    Object.keys(vocabulary.aliases).length >= 120,
    "El vocabulario debe conservar al menos 120 expresiones españolas",
  );
  for (const [alias, canonical] of Object.entries(vocabulary.aliases)) {
    assert(
      search(alias).length > 0,
      `El alias «${alias}» no lleva a su alimento canónico «${canonical}»`,
    );
  }
  for (const query of Object.keys(vocabulary.excluded)) {
    assert.strictEqual(
      feedback(query).type,
      "excluded",
      `La exclusión «${query}» no tiene explicación específica`,
    );
  }
  assert.strictEqual(feedback("yogurr").type, "suggestion");
  assert.strictEqual(feedback("alimento que no existe").type, "missing");

  const classified = queries.filter((query) => {
    if (search(query).length > 0) return true;
    return ["excluded", "suggestion", "missing"].includes(
      feedback(query).type,
    );
  });
  assert(
    classified.length / queries.length >= 0.95,
    "Menos del 95% del corpus recibe resultado o estado vacío específico",
  );

  assert.match(indexSource, /role="combobox"/);
  assert.match(indexSource, /aria-autocomplete="list"/);
  assert.match(indexSource, /aria-controls="autocompleteDropdown"/);
  assert.match(indexSource, /role="listbox"/);
  assert.match(indexSource, /role="option"/);
  assert.match(indexSource, /event\.key === "ArrowDown"/);
  assert.match(indexSource, /event\.key === "Enter"/);
  assert.match(indexSource, /event\.key === "Escape"/);

  console.log(
    `PASS C7: ${Object.keys(vocabulary.aliases).length} alias, ` +
      `${Object.keys(vocabulary.excluded).length} exclusiones explicadas y combobox accesible`,
  );
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
