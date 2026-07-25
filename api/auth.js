const { createClient } = require('@supabase/supabase-js');
const { safeEqual, setSessionCookie } = require('./_session');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 6;

function requestKey(req, email) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
  return `${ip}:${email}`;
}

function isRateLimited(key) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_ATTEMPTS;
}

function clearAttempts(key) {
  attempts.delete(key);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, code } = req.body || {};
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const normalizedCode = String(code || '').toUpperCase().trim();

  if (!normalizedEmail || !normalizedCode ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      normalizedCode.length > 128) {
    return res.status(400).json({ success: false, error: 'Completá todos los campos.' });
  }

  const key = requestKey(req, normalizedEmail);
  if (isRateLimited(key)) {
    return res.status(429).json({
      success: false,
      error: 'Demasiados intentos. Esperá unos minutos antes de volver a probar.',
    });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('name, email, code, active')
    .eq('email', normalizedEmail)
    .single();

  if (error || !user || !safeEqual(String(user.code || ''), normalizedCode)) {
    return res.status(401).json({
      success: false,
      error: 'Email o código incorrectos.',
    });
  }

  if (!user.active) {
    return res.status(403).json({ success: false, error: 'Tu acceso fue desactivado. Contactá a tu nutricionista.' });
  }

  clearAttempts(key);
  setSessionCookie(req, res, user);
  return res.json({ success: true, name: user.name, email: user.email });
};
