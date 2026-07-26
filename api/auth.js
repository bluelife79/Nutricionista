const { authClient, serviceClient } = require('./_supabase');
const { setSessionCookie } = require('./_session');

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

  const { email, password, code } = req.body || {};
  const normalizedEmail = String(email || '').toLowerCase().trim();
  // `code` mantiene compatibilidad con una copia antigua de la PWA durante la actualización.
  const suppliedPassword = String(password || code || '');

  if (!normalizedEmail || !suppliedPassword ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      suppliedPassword.length > 128) {
    return res.status(400).json({ success: false, error: 'Completa todos los campos.' });
  }

  const key = requestKey(req, normalizedEmail);
  if (isRateLimited(key)) {
    return res.status(429).json({
      success: false,
      error: 'Demasiados intentos. Espera unos minutos antes de volver a probar.',
    });
  }

  let signedIn;
  try {
    const result = await authClient().auth.signInWithPassword({
      email: normalizedEmail,
      password: suppliedPassword,
    });
    if (result.error || !result.data.user) {
      return res.status(401).json({
        success: false,
        error: 'Email o contraseña incorrectos.',
      });
    }
    signedIn = result.data.user;
  } catch {
    return res.status(503).json({
      success: false,
      error: 'No hemos podido verificar el acceso. Inténtalo de nuevo.',
    });
  }

  if (signedIn.app_metadata?.role !== 'member') {
    return res.status(403).json({
      success: false,
      error: 'Esta cuenta no tiene acceso a la herramienta de clientas.',
    });
  }

  const supabase = serviceClient();
  const { data: profile, error } = await supabase
    .from('users')
    .select('name, email, active')
    .eq('email', normalizedEmail)
    .single();

  if (error || !profile) {
    return res.status(403).json({
      success: false,
      error: 'Tu cuenta todavía no está activada. Contacta con tu nutricionista.',
    });
  }

  if (!profile.active) {
    return res.status(403).json({
      success: false,
      error: 'Tu acceso está desactivado. Contacta con tu nutricionista.',
    });
  }

  clearAttempts(key);
  setSessionCookie(req, res, {
    id: signedIn.id,
    email: profile.email,
  });
  return res.json({ success: true, name: profile.name, email: profile.email });
};
