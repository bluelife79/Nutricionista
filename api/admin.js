const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function isAdmin(req) {
  return req.headers['x-admin-password'] === process.env.ADMIN_PASSWORD;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAdmin(req)) {
    return res.status(401).json({ success: false, error: 'No autorizado.' });
  }

  // GET — listar todas las usuarias
  if (req.method === 'GET') {
    const { data: users, error } = await supabase
      .from('users')
      .select('name, email, code, active, created_at')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ success: false, error: 'Error al cargar clientas.' });

    return res.json({ success: true, users });
  }

  // POST — crear o toggle
  if (req.method === 'POST') {
    const { action, email, name, code } = req.body || {};

    if (action === 'create') {
      if (!name || !email || !code) {
        return res.status(400).json({ success: false, error: 'Nombre, email y código son obligatorios.' });
      }

      const { data: user, error } = await supabase
        .from('users')
        .insert({
          name: name.trim(),
          email: email.toLowerCase().trim(),
          code: code.toUpperCase().trim(),
          active: true,
        })
        .select()
        .single();

      if (error) {
        const msg = error.code === '23505'
          ? 'Ya existe una clienta con ese email.'
          : 'Error al crear clienta.';
        return res.status(400).json({ success: false, error: msg });
      }

      return res.json({ success: true, user });
    }

    if (action === 'toggle') {
      if (!email) {
        return res.status(400).json({ success: false, error: 'Email requerido.' });
      }

      const { data: current } = await supabase
        .from('users')
        .select('active')
        .eq('email', email.toLowerCase().trim())
        .single();

      if (!current) {
        return res.status(404).json({ success: false, error: 'Clienta no encontrada.' });
      }

      const { data: user, error } = await supabase
        .from('users')
        .update({ active: !current.active })
        .eq('email', email.toLowerCase().trim())
        .select()
        .single();

      if (error) return res.status(500).json({ success: false, error: 'Error al cambiar estado.' });

      return res.json({ success: true, user });
    }

    return res.status(400).json({ success: false, error: 'Acción desconocida.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
