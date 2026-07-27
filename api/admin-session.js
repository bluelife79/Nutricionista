const { serviceClient } = require('./_supabase');
const {
  clearAdminSessionCookie,
  readAdminSession,
} = require('./_session');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'DELETE') {
    clearAdminSessionCookie(req, res);
    return res.json({ success: true });
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let session;
  try {
    session = readAdminSession(req);
  } catch {
    return res.status(503).json({ success: false, error: 'Sesión no configurada.' });
  }
  if (!session || !session.sub) {
    clearAdminSessionCookie(req, res);
    return res.status(401).json({ success: false });
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.auth.admin.getUserById(session.sub);
  const user = data?.user;
  if (error || !user || user.app_metadata?.role !== 'admin' ||
      String(user.email || '').toLowerCase() !== session.email) {
    clearAdminSessionCookie(req, res);
    return res.status(401).json({ success: false });
  }

  return res.json({ success: true, email: user.email });
};
