"use strict";

const express = require("express");
const path = require("path");

const app = express();
let authenticated = true;

app.use(express.json());
app.get("/api/session", (_req, res) => {
  if (!authenticated) return res.status(401).json({ success: false });
  return res.json({ success: true, name: "Prueba E2E", email: "e2e@local.test" });
});
app.delete("/api/session", (_req, res) => {
  authenticated = false;
  return res.json({ success: true });
});
app.post("/api/auth", (req, res) => {
  if (req.body?.email !== "e2e@local.test" || req.body?.code !== "LOCALTEST2026") {
    return res.status(401).json({ success: false, error: "Email o código incorrectos." });
  }
  authenticated = true;
  return res.json({ success: true, name: "Prueba E2E", email: "e2e@local.test" });
});
app.use(express.static(path.join(__dirname, "..")));

const port = Number(process.env.E2E_PORT || 4173);
app.listen(port, "127.0.0.1", () => {
  console.log(`E2E server ready at http://127.0.0.1:${port}`);
});
