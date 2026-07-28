#!/usr/bin/env node

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
process.env.SESSION_SECRET =
  "test-only-session-secret-with-more-than-24-characters";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

const telemetryHandler = require("../api/telemetry");
const {
  ALLOWED_EVENTS,
  normalizedTerm,
  safeId,
  sanitize,
} = telemetryHandler._test;

assert.ok(ALLOWED_EVENTS.has("search_empty"));
assert.ok(ALLOWED_EVENTS.has("abandon"));
assert.strictEqual(normalizedTerm("  Queso fresco batido  "), "queso fresco batido");
assert.strictEqual(normalizedTerm("usuaria@example.com"), "");
assert.strictEqual(normalizedTerm("+34 612 345 678"), "");
assert.strictEqual(normalizedTerm("612345678"), "");
assert.strictEqual(normalizedTerm("12345678"), "");
assert.strictEqual(normalizedTerm("Arroz 3 delicias"), "arroz 3 delicias");
assert.strictEqual(safeId("off_abc-123"), "off_abc-123");
assert.strictEqual(safeId("../../email@example.com"), null);

assert.deepStrictEqual(sanitize("results_rendered", {
  direct_count: 9999,
  family_count: -4,
  prepared_count: 2.2,
  duration_bucket_ms: 90000,
  cache_hit: true,
  email: "never@example.com",
}), {
  direct_count: 500,
  family_count: 0,
  prepared_count: 2,
  duration_bucket_ms: 30000,
  cache_hit: true,
});
assert.deepStrictEqual(sanitize("abandon", {
  email: "never@example.com",
  food_history: ["pollo"],
}), {});

const clientSource = source("js/telemetry.js");
const indexSource = source("index.html");
const apiSource = source("api/telemetry.js");
const maintenanceSource = source("api/telemetry-maintenance.js");
const migrationSource = source(
  "supabase/migrations/202607270002_anonymous_telemetry.sql",
);
const vercel = JSON.parse(source("vercel.json"));

assert.match(indexSource, /<summary>Privacidad<\/summary>/);
assert.match(indexSource, /No guardamos\s+tu email ni un historial personal/);
assert.match(indexSource, /id="telemetryEnabled"/);
assert.match(clientSource, /revolucionat_telemetry_optout/);
assert.doesNotMatch(clientSource, /email|user_id|session_id|fingerprint/i);
assert.doesNotMatch(apiSource, /session\.(?:sub|email)|user_id|session_id|ip_address/);
assert.match(apiSource, /contentLength > 4096/);
assert.match(migrationSource, /having count\(\*\) >= 5/i);
assert.match(migrationSource, /interval '24 hours'/);
assert.match(migrationSource, /current_date - 90/);
assert.match(migrationSource, /enable row level security/);
assert.match(maintenanceSource, /CRON_SECRET/);
assert.ok(
  vercel.crons.some(
    (cron) =>
      cron.path === "/api/telemetry-maintenance" &&
      typeof cron.schedule === "string",
  ),
  "Falta la limpieza diaria de telemetría",
);

const calls = [];
const storage = new Map();
const listeners = {};
const context = {
  Blob,
  fetch(url, options) {
    calls.push({ url, options });
    return Promise.resolve({ ok: true });
  },
  navigator: {
    sendBeacon(url, body) {
      calls.push({ url, body, beacon: true });
      return true;
    },
  },
  localStorage: {
    getItem(key) {
      return storage.get(key) || null;
    },
    setItem(key, value) {
      storage.set(key, value);
    },
    removeItem(key) {
      storage.delete(key);
    },
  },
  addEventListener(name, listener) {
    listeners[name] = listener;
  },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(clientSource, context, { filename: "js/telemetry.js" });

context.trackAnonymousEvent("search", { term: "avena" });
assert.strictEqual(calls.length, 1);
context.setAnonymousTelemetryEnabled(false);
context.trackAnonymousEvent("search", { term: "pollo" });
assert.strictEqual(calls.length, 1, "El opt-out no detuvo la medición");
context.setAnonymousTelemetryEnabled(true);
context.markAnonymousResultsShown();
listeners.pagehide();
assert.strictEqual(calls.at(-1).beacon, true);

console.log(
  "PASS C14e: telemetría mínima, sin identidad, con opt-out y retención controlada",
);
