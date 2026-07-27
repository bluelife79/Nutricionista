const { authClient, serviceClient } = require('./_supabase');
const { setSessionCookie } = require('./_session');
const {
  clearRateLimit,
  consumeRateLimit,
} = require('./_rate_limit');

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

  let supabase;
  try {
    supabase = serviceClient();
    if (await consumeRateLimit(supabase, req, normalizedEmail, 'member_login')) {
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

  try {
    await clearRateLimit(supabase, req, normalizedEmail, 'member_login');
  } catch {
    return res.status(503).json({
      success: false,
      error: 'Acceso correcto, pero no se pudo cerrar la verificación de seguridad. Inténtalo de nuevo.',
    });
  }
  setSessionCookie(req, res, {
    id: signedIn.id,
    email: profile.email,
    sessionVersion: Number(signedIn.app_metadata?.session_version || 1),
  });
  return res.json({ success: true, name: profile.name, email: profile.email });
};
