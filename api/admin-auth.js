const { authClient } = require('./_supabase');
const { setAdminSessionCookie } = require('./_session');

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 6;

function requestKey(req, email) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
  return `${ip}:${email}`;
}

function blocked(key) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_ATTEMPTS;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const email = String(req.body?.email || '').toLowerCase().trim();
  const password = String(req.body?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 128) {
    return res.status(400).json({ success: false, error: 'Completa el email y la contraseña.' });
  }

  const key = requestKey(req, email);
  if (blocked(key)) {
    return res.status(429).json({
      success: false,
      error: 'Demasiados intentos. Espera unos minutos antes de volver a probar.',
    });
  }

  try {
    const { data, error } = await authClient().auth.signInWithPassword({ email, password });
    if (error || !data.user || data.user.app_metadata?.role !== 'admin') {
      return res.status(401).json({ success: false, error: 'Datos de administración incorrectos.' });
    }
    attempts.delete(key);
    setAdminSessionCookie(req, res, {
      id: data.user.id,
      email: data.user.email,
    });
    return res.json({ success: true, email: data.user.email });
  } catch {
    return res.status(503).json({
      success: false,
      error: 'No hemos podido verificar el acceso. Inténtalo de nuevo.',
    });
  }
};
