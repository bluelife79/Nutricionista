"use strict";

const assert = require("assert");
const { runProductIntentAudit } = require("./audit_product_intents");

async function main() {
  const report = await runProductIntentAudit();
  assert(
    report.totals.promptedOrigins >= 350,
    "La personalización culinaria quedó demasiado corta",
  );
  assert.strictEqual(
    report.totals.zeroDirect,
    0,
    "Una respuesta culinaria deja el bloque de intercambios vacío",
  );
  assert.strictEqual(
    report.totals.fewerThanThreeDirect,
    0,
    "Una respuesta culinaria deja menos de tres intercambios",
  );
  assert.strictEqual(
    report.totals.fewerThanAny,
    0,
    "Responder a una pregunta reduce el universo frente a «Me da igual»",
  );
  assert.strictEqual(
    report.totals.promptsWithoutTop10Change,
    0,
    "Se muestra una pregunta que no cambia el TOP visible",
  );
  console.log(
    `PASS C6: ${report.totals.promptedOrigins} preguntas, ` +
      `${report.totals.optionScenarios} respuestas sin colapso`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
