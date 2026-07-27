const { serviceClient } = require('./_supabase');
const { clearSessionCookie, readSession } = require('./_session');

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
  if (!session || !session.sub) {
    clearSessionCookie(req, res);
    return res.status(401).json({ success: false });
  }

  const supabase = serviceClient();
  const [{ data: authData, error: authError }, { data: profile, error: profileError }] =
    await Promise.all([
      supabase.auth.admin.getUserById(session.sub),
      supabase
        .from('users')
        .select('name, email, active')
        .eq('email', session.email)
        .single(),
    ]);

  const authUser = authData?.user;
  if (authError || !authUser || authUser.app_metadata?.role !== 'member' ||
      Number(authUser.app_metadata?.session_version || 1) !== Number(session.version || 1) ||
      profileError || !profile || !profile.active ||
      String(authUser.email || '').toLowerCase() !== String(profile.email || '').toLowerCase()) {
    clearSessionCookie(req, res);
    const inactive = profile && !profile.active;
    return res.status(inactive ? 403 : 401).json({
      success: false,
      error: inactive
        ? 'Tu acceso está desactivado. Contacta con tu nutricionista.'
        : 'Sesión no válida.',
    });
  }

  return res.json({ success: true, name: profile.name, email: profile.email });
};
