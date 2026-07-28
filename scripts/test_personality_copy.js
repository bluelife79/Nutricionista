"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const algorithm = fs.readFileSync(
  path.join(ROOT, "js", "algorithm.js"),
  "utf8",
);
const scope = fs.readFileSync(
  path.join(ROOT, "js", "exchange_scope.js"),
  "utf8",
);
const weight = fs.readFileSync(
  path.join(ROOT, "config", "weight_basis_bridges.json"),
  "utf8",
);

for (const text of [
  "Cambio redondo",
  "Buen cambio",
  "Puede encajarte",
  "Aquí no te voy a vender humo",
  "El mismo alimento, con otro traje",
  "Pon los gramos que tienes en el menú. Nosotros hacemos las cuentas.",
  "Lo que conviene saber",
]) {
  assert(
    index.toLowerCase().includes(text.toLowerCase()) ||
      algorithm.toLowerCase().includes(text.toLowerCase()),
    `Falta la voz aprobada: ${text}`,
  );
}

for (const text of [
  "También te vale",
  "Nos falta información",
  "Capricho con sitio",
  "Mejor como capricho que como fondo de armario.",
]) {
  assert(scope.includes(text), `Falta el aviso humano: ${text}`);
}

for (const text of [
  "Encaja nutricionalmente y no presenta señales",
  "intercambio clínico equivalente",
  "Criterio RevolucionaT:",
  "Revisá",
]) {
  assert(
    !index.includes(text) && !scope.includes(text),
    `Sigue visible un texto técnico o impropio: ${text}`,
  );
}

assert.match(
  weight,
  /Ojo con la báscula: uno se pesa en crudo y el otro, ya cocinado\./,
);
assert.match(index, /<summary>Privacidad<\/summary>/);
assert.doesNotMatch(index, /Privacidad y mejora de la herramienta/);
assert.match(index, /"Hola, "\s*\+\s*displayName\s*\+\s*" 🚀"/);
assert.doesNotMatch(index, /displayName\s*\+\s*" 👋"/);
assert.match(
  index,
  /\.app-brand-logo-wrap\s*\{[\s\S]*?background:\s*transparent/,
);
assert.match(
  index,
  /\.splash-brand-logo\s*\{[\s\S]*?background:\s*transparent/,
);

console.log(
  "PASS personalidad: voz clara, avisos útiles y tecnicismos fuera de la interfaz",
);
