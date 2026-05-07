// Proxy serverless function: reenvía cualquier request bajo
//   /api/microservice/<path>
// hacia el microservicio Python desplegado en Railway/Coolify, leyendo
// la URL desde process.env.RERANK_API_URL (configurada en Vercel envs).
//
// Beneficios frente a llamada directa desde el browser:
//   1. La URL del microservicio NUNCA se expone en HTML/JS del cliente.
//   2. Mismo origen → cero problemas de CORS / preflight.
//   3. Si rotamos la URL del backend, basta con cambiar la env var.
//
// Patrón de uso desde algorithm.js (en producción):
//   fetch('/api/microservice/judge',  { method: 'POST', body: ... })
//   fetch('/api/microservice/rerank', { method: 'POST', body: ... })
//
// En dev local (localhost) se sigue llamando directo al microservicio
// (ver index.html), porque Vercel functions no corren bajo `node server.js`.

module.exports = async (req, res) => {
  const baseUrl = process.env.RERANK_API_URL;
  if (!baseUrl) {
    return res.status(500).json({
      error: 'misconfigured',
      detail: 'RERANK_API_URL no está seteada en las env vars de Vercel.',
    });
  }

  // req.query.path es array por el catch-all [...path].js
  const segments = req.query.path || [];
  const subPath = Array.isArray(segments) ? segments.join('/') : segments;
  const targetUrl = `${baseUrl.replace(/\/$/, '')}/${subPath}`;

  // Vercel runtime es Node 18+ → fetch nativo disponible.
  // Timeout 8s — el LLM judge típicamente tarda 1-3s; deja margen.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: ['POST', 'PUT', 'PATCH'].includes(req.method)
        ? JSON.stringify(req.body)
        : undefined,
      signal: controller.signal,
    });

    const text = await upstream.text();
    res.status(upstream.status);
    // Reenviar como JSON si parsea, si no como texto plano (defensivo).
    try {
      res.json(JSON.parse(text));
    } catch {
      res.send(text);
    }
  } catch (err) {
    const aborted = err.name === 'AbortError';
    return res.status(aborted ? 504 : 502).json({
      error: aborted ? 'upstream_timeout' : 'upstream_unreachable',
      detail: err.message,
    });
  } finally {
    clearTimeout(timer);
  }
};
