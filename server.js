require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());

// ── Middleware: Inyectar URL del microservicio en index.html ──────────────────
const rerankApiUrl = process.env.RERANK_API_URL || "http://localhost:8000";

app.get("/", (req, res) => {
  const indexPath = path.join(__dirname, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");

  // Reemplazar el meta tag con la URL del .env
  html = html.replace(
    /<meta name="rerank-api-url" content="[^"]*" \/>/,
    `<meta name="rerank-api-url" content="${rerankApiUrl}" />`,
  );

  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ── Servir archivos estáticos (excepto index.html) ─────────────────────────
app.use(
  express.static(path.join(__dirname), {
    index: false, // No servir index.html automáticamente
  }),
);

app.all("/api/auth", require("./api/auth"));
app.all("/api/admin", require("./api/admin"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ App corriendo en http://localhost:${PORT}`);
  console.log(`📡 Microservicio en: ${rerankApiUrl}`);
  console.log(`🔐 Panel admin en http://localhost:${PORT}/admin.html`);
});
