const { createClient } = require('@supabase/supabase-js');
const { clearSessionCookie, readSession } = require('./_session');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'DELETE') {
    clearSessionCookie(req, res);
    return res.json({ success: true });
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let session;
  try {
    session = readSession(req);
  } catch {
    return res.status(503).json({ success: false, error: 'Sesión no configurada.' });
  }
  if (!session) {
    clearSessionCookie(req, res);
    return res.status(401).json({ success: false });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('name, email, active')
    .eq('email', session.email)
    .single();

  if (error || !user || !user.active) {
    clearSessionCookie(req, res);
    return res.status(user && !user.active ? 403 : 401).json({
      success: false,
      error: user && !user.active
        ? 'Tu acceso fue desactivado. Contactá a tu nutricionista.'
        : 'Sesión no válida.',
    });
  }

  return res.json({ success: true, name: user.name, email: user.email });
};
