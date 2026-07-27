"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ROOT } = require("./lib/algorithm_harness");

function main() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  assert.doesNotMatch(html, /user-scalable\s*=\s*no/i);
  assert.doesNotMatch(html, /maximum-scale\s*=/i);
  assert.match(html, /<html lang="es">/);
  assert.match(html, /for="searchInput"/);
  assert.match(html, /for="amountInput"/);
  assert.match(html, /aria-label="Quitar alimento seleccionado"/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-autocomplete="list"/);
  assert.match(html, /aria-controls="autocompleteDropdown"/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /role="option"/);
  assert.match(html, /aria-activedescendant/);
  assert.match(html, /event\.key === "ArrowDown"/);
  assert.match(html, /event\.key === "ArrowUp"/);
  assert.match(html, /event\.key === "Enter"/);
  assert.match(html, /event\.key === "Escape"/);
  assert.match(
    html,
    /\.app-logout\s*\{[\s\S]*?min-height:\s*44px/,
  );
  assert.match(
    html,
    /\.clear-btn\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px/,
  );
  assert.match(
    html,
    /\.result-brand\s*\{[\s\S]*?font-size:\s*14px;[\s\S]*?color:\s*#5f6472/,
  );
  assert.match(
    html,
    /\.item-brand\s*\{[\s\S]*?font-size:\s*14px;[\s\S]*?color:\s*#5f6472/,
  );

  console.log(
    "PASS C14-a11y: zoom, etiquetas, combobox, teclado, contraste y objetivos táctiles",
  );
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
