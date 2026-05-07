// Proxy serverless: forwards POST /api/judge → ${RERANK_API_URL}/judge.
// La URL real del backend (env var en Vercel) NUNCA aparece en el cliente.
//
// Vercel "Other" framework no parsea catch-all dinámicos ([...path].js)
// por eso usamos un archivo flat por endpoint.

const TIMEOUT_MS = 8000;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const baseUrl = process.env.RERANK_API_URL;
  if (!baseUrl) {
    return res.status(500).json({
      error: 'misconfigured',
      detail: 'RERANK_API_URL no está seteada en las env vars de Vercel.',
    });
  }

  const targetUrl = `${baseUrl.replace(/\/$/, '')}/judge`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
      signal: controller.signal,
    });

    const text = await upstream.text();
    res.status(upstream.status);
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
