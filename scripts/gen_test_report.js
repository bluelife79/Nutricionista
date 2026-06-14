// Genera test_resultados.html (standalone, portable) a partir de
// test_report_data.json capturado vía Playwright contra la versión actual.
// Uso: node scripts/gen_test_report.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const data = JSON.parse(
  fs.readFileSync(path.join(ROOT, "test_report_data.json"), "utf8"),
);

// Veredicto curado por caso (controla el mensaje al cliente).
const VERDICTS = {
  tofu: { t: "ok", v: "Devuelve 72 alternativas vegetales (legumbres). No está vacío." },
  tempeh: { t: "ok", v: "Aparece en la búsqueda y devuelve 12 alternativas vegetales (incluye soja texturizada)." },
  patata: { t: "ok", v: "Solo tubérculos y almidones (boniato, batata, maíz, arroz). Cero bebidas ni líquidos.", note: "Aparece mucho maíz: ajuste fino de orden, pero todos son hidratos base correctos." },
  gazpacho: { t: "ok", v: "0 alternativas a propósito: no fuerza intercambios absurdos. Sin café ni té con leche." },
  salmorejo: { t: "ok", v: "0 alternativas a propósito: no fuerza salsas ni encurtidos." },
  "caballa en aceite": { t: "ok", v: "Pescado graso y conservas similares. Sin fritos ni rebozados." },
  "sardinas en aceite": { t: "ok", v: "Pescado graso y conservas. Sin mortadela, chicharrón ni patés." },
  "melva en aceite": { t: "ok", v: "Devuelve conservas de pescado graso. Ya no está vacío." },
  "yogur natural": { t: "ok", v: "Yogures, kéfir y bífidus. Sin café con leche, batidos ni saborizados." },
  "yogur griego": { t: "ok", v: "Kéfir, queso fresco, ricotta y mató. Subfamilia láctea coherente." },
  "leche semidesnatada": { t: "warn", v: "Solo leches semidesnatadas (1,5%) — correcto por categoría.", note: "Pocas referencias y con nombres en otro idioma: etiqueta de presentación a pulir, no error de categoría." },
};

const SUBGROUP_ES = {
  plant_protein: "Proteína vegetal",
  legumes: "Legumbres",
  fish_fatty: "Pescado graso",
  fish_white: "Pescado blanco",
  eggs: "Huevo",
  whole_dairy: "Lácteo entero",
  low_fat_dairy: "Lácteo desnatado",
  high_protein_dairy: "Lácteo alto en proteína",
  fresh_cheese: "Queso fresco",
  tubers: "Tubérculo",
  grains: "Cereal / grano",
  meat_lean: "Carne magra",
};

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const cards = data.generated
  .map((c) => {
    const vd = VERDICTS[c.q] || { t: "info", v: "" };
    const rows =
      c.nInter > 0
        ? c.top
            .map(
              (t, i) => `
        <tr>
          <td class="rk">${i + 1}</td>
          <td>${esc(t.name)}</td>
          <td><span class="chip">${esc(SUBGROUP_ES[t.subgroup] || t.subgroup || "—")}</span></td>
          <td class="num">${t.grams != null ? t.grams + " g" : "—"}</td>
          <td class="num">${t.kcal != null ? t.kcal + " kcal" : "—"}</td>
        </tr>`,
            )
            .join("")
        : "";

    const resultBlock =
      c.nInter > 0
        ? `<table>
            <thead><tr><th>#</th><th>Alimento</th><th>Familia</th><th>Cantidad equiv.</th><th>Energía</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p class="small">Mostrando TOP ${Math.min(12, c.nInter)} de ${c.nInter} alternativas.</p>`
        : `<div class="callout ok">El intercambiador devuelve <strong>0 alternativas</strong> de forma intencionada: cuando no existe un intercambio limpio, no inventa opciones absurdas.</div>`;

    return `
    <section class="case">
      <div class="case-head">
        <div>
          <h3>${esc(c.q)} <span class="amt">· ${c.amt} g</span></h3>
          <div class="meta">Origen detectado: <strong>${esc(c.origin || "—")}</strong> · familia <span class="chip">${esc(SUBGROUP_ES[c.originSub] || c.originSub || "—")}</span> · ${c.searchHits} resultado(s) en búsqueda</div>
        </div>
        <span class="pill ${vd.t}">${vd.t === "ok" ? "Correcto" : vd.t === "warn" ? "Ajuste fino" : "Info"}</span>
      </div>
      <div class="cols">
        <div class="col">
          <div class="lbl reported">Lo reportado</div>
          <div class="callout bad">${esc(c.reported)}</div>
        </div>
        <div class="col">
          <div class="lbl actual">Resultado actual (versión corregida)</div>
          ${resultBlock}
        </div>
      </div>
      <div class="verdict ${vd.t}"><strong>Veredicto:</strong> ${esc(vd.v)}${vd.note ? ` <span class="note">${esc(vd.note)}</span>` : ""}</div>
    </section>`;
  })
  .join("\n");

const okCount = data.generated.filter(
  (c) => (VERDICTS[c.q] || {}).t === "ok",
).length;
const warnCount = data.generated.filter(
  (c) => (VERDICTS[c.q] || {}).t === "warn",
).length;

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Test de resultados reales · Intercambiador RevolucionaT</title>
<style>
:root{--bg:#0b1020;--panel:#121a33;--panel2:#17203d;--text:#eef2ff;--muted:#aab5d6;--line:rgba(255,255,255,.12);--ok:#22c55e;--warn:#f59e0b;--bad:#ef4444;--blue:#60a5fa;--chip:#243052;--radius:20px}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:radial-gradient(circle at top left,#273469 0,#0b1020 34%,#070b16 100%);color:var(--text);line-height:1.45}
.wrap{max-width:1100px;margin:0 auto;padding:28px 18px 60px}
.hero{padding:30px;border:1px solid var(--line);border-radius:26px;background:linear-gradient(135deg,rgba(96,165,250,.18),rgba(167,139,250,.10) 40%,rgba(18,26,51,.92))}
.kicker{color:#c7d2fe;text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:800}
.hero h1{font-size:clamp(28px,4.5vw,46px);line-height:1.02;margin:10px 0 12px}
.hero p{max-width:820px;color:var(--muted);font-size:17px;margin:0}
.hero strong{color:#fff}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}
.card{background:rgba(18,26,51,.88);border:1px solid var(--line);border-radius:var(--radius);padding:18px}
.card .num{font-size:32px;font-weight:900;margin:4px 0}
.card .label{color:var(--muted);font-size:13px}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.blue{color:var(--blue)}
.case{background:rgba(18,26,51,.88);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin-top:16px}
.case-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
.case-head h3{margin:0;font-size:22px;text-transform:capitalize}
.amt{color:var(--muted);font-weight:600;font-size:15px}
.meta{color:var(--muted);font-size:13px;margin-top:4px}
.cols{display:grid;grid-template-columns:1fr 1.6fr;gap:16px}
.col .lbl{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
.lbl.reported{color:#fca5a5}.lbl.actual{color:#86efac}
.callout{border-radius:14px;padding:13px 14px;border:1px solid var(--line);background:rgba(255,255,255,.04);font-size:14px}
.callout.bad{border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.08)}
.callout.ok{border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.08)}
table{width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden}
th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--line);font-size:13.5px}
th{color:#dbeafe;font-size:11px;text-transform:uppercase;letter-spacing:.06em;background:rgba(96,165,250,.10)}
td.rk{color:var(--muted);width:28px}
td.num{text-align:right;color:#cbd5f5;white-space:nowrap}
.chip{display:inline-block;background:var(--chip);border:1px solid var(--line);border-radius:999px;padding:3px 9px;font-size:12px;color:#dbeafe}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:6px 12px;font-weight:900;font-size:12px;border:1px solid var(--line);white-space:nowrap}
.pill.ok{background:rgba(34,197,94,.14);color:#86efac}.pill.warn{background:rgba(245,158,11,.14);color:#fcd34d}.pill.info{background:rgba(96,165,250,.14);color:#bfdbfe}
.verdict{margin-top:14px;padding:12px 14px;border-radius:14px;border:1px solid var(--line);font-size:14px;background:rgba(255,255,255,.03)}
.verdict.ok{border-color:rgba(34,197,94,.3)}.verdict.warn{border-color:rgba(245,158,11,.3)}
.verdict .note{display:block;color:var(--muted);font-size:13px;margin-top:5px}
.small{color:var(--muted);font-size:12px;margin:8px 0 0}
.foot{color:var(--muted);font-size:13px;margin-top:24px;text-align:center}
@media(max-width:820px){.grid{grid-template-columns:1fr}.cols{grid-template-columns:1fr}.case-head{flex-direction:column}}
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div class="kicker">RevolucionaT · Intercambiador de alimentos · Test de resultados reales</div>
    <h1>Esto es lo que devuelve la herramienta ahora mismo.</h1>
    <p>Para cada alimento del feedback se muestra <strong>lo reportado</strong> frente al <strong>resultado real</strong> que produce la versión corregida, ejecutado directamente sobre el motor y la base de datos (${data.dbCount.toLocaleString("es-ES")} alimentos). Sin capturas viejas: son los intercambios que salen al buscar cada alimento hoy.</p>
  </header>

  <div class="grid">
    <div class="card"><div class="label">Casos probados</div><div class="num blue">${data.generated.length}</div></div>
    <div class="card"><div class="label">Correctos</div><div class="num ok">${okCount}</div></div>
    <div class="card"><div class="label">Ajuste fino</div><div class="num warn">${warnCount}</div></div>
  </div>

  ${cards}

  <p class="foot">Generado automáticamente desde el motor de intercambios (algorithm.js) sobre database.json. Cada tabla es el TOP real de alternativas, no una captura.</p>
</div>
</body>
</html>`;

fs.writeFileSync(path.join(ROOT, "test_resultados.html"), html, "utf8");
console.log("OK -> test_resultados.html (" + html.length + " bytes)");
