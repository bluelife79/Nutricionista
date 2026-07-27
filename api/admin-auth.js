const { authClient, serviceClient } = require('./_supabase');
const { setAdminSessionCookie } = require('./_session');
const {
  clearRateLimit,
  consumeRateLimit,
} = require('./_rate_limit');

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

  let supabase;
  try {
    supabase = serviceClient();
    if (await consumeRateLimit(supabase, req, email, 'admin_login')) {
      return res.status(429).json({
        success: false,
        error: 'Demasiados intentos. Espera unos minutos antes de volver a probar.',
      });
    }
  } catch {
    return res.status(503).json({
      success: false,
      error: 'No hemos podido proteger el acceso. Inténtalo de nuevo.',
    });
  }

  try {
    const { data, error } = await authClient().auth.signInWithPassword({ email, password });
    if (error || !data.user || data.user.app_metadata?.role !== 'admin') {
      return res.status(401).json({ success: false, error: 'Datos de administración incorrectos.' });
    }
    await clearRateLimit(supabase, req, email, 'admin_login');
    setAdminSessionCookie(req, res, {
      id: data.user.id,
      email: data.user.email,
      sessionVersion: Number(data.user.app_metadata?.session_version || 1),
    });
    return res.json({ success: true, email: data.user.email });
  } catch {
    return res.status(503).json({
      success: false,
      error: 'No hemos podido verificar el acceso. Inténtalo de nuevo.',
    });
  }
};
