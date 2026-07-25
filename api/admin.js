const { createClient } = require('@supabase/supabase-js');
const { safeEqual } = require('./_session');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function isAdmin(req) {
  const configured = String(process.env.ADMIN_PASSWORD || '');
  if (configured.length < 12) return false;
  return safeEqual(req.headers['x-admin-password'], configured);
}

function adminIsConfigured() {
  return String(process.env.ADMIN_PASSWORD || '').length >= 12;
}

function validAccessCode(code) {
  return /^[A-Z0-9_.-]{8,64}$/.test(String(code || '').toUpperCase().trim());
}

function validIdentity(name, email) {
  const normalizedName = String(name || '').trim();
  const normalizedEmail = String(email || '').toLowerCase().trim();
  return normalizedName.length >= 2 &&
    normalizedName.length <= 120 &&
    normalizedEmail.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
}

function publicUser(user) {
  if (!user) return user;
  const { code, ...safe } = user;
  return safe;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!adminIsConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'ADMIN_PASSWORD debe tener al menos 12 caracteres antes de habilitar el panel.',
    });
  }
  if (!isAdmin(req)) {
    return res.status(401).json({ success: false, error: 'No autorizado.' });
  }

  // GET — listar todas las usuarias
  if (req.method === 'GET') {
    const { data: users, error } = await supabase
      .from('users')
      .select('name, email, active, created_at')
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
      if (!validIdentity(name, email)) {
        return res.status(400).json({ success: false, error: 'Nombre o email no válidos.' });
      }
      if (!validAccessCode(code)) {
        return res.status(400).json({
          success: false,
          error: 'El código debe tener 8–64 caracteres (letras, números, punto, guion o guion bajo).',
        });
      }

      const { data: user, error } = await supabase
        .from('users')
        .insert({
          name: name.trim(),
          email: email.toLowerCase().trim(),
          code: code.toUpperCase().trim(),
          active: true,
        })
        .select('name, email, active, created_at')
        .single();

      if (error) {
        const msg = error.code === '23505'
          ? 'Ya existe una clienta con ese email.'
          : 'Error al crear clienta.';
        return res.status(400).json({ success: false, error: msg });
      }

      return res.json({ success: true, user: publicUser(user) });
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
        .select('name, email, active, created_at')
        .single();

      if (error) return res.status(500).json({ success: false, error: 'Error al cambiar estado.' });

      return res.json({ success: true, user: publicUser(user) });
    }

    if (action === 'update') {
      const { originalEmail } = req.body;
      if (!originalEmail || !name || !email) {
        return res.status(400).json({ success: false, error: 'Nombre y email son obligatorios.' });
      }
      if (!validIdentity(name, email)) {
        return res.status(400).json({ success: false, error: 'Nombre o email no válidos.' });
      }
      if (code && !validAccessCode(code)) {
        return res.status(400).json({
          success: false,
          error: 'El nuevo código debe tener 8–64 caracteres válidos.',
        });
      }

      const updates = {
        name: name.trim(),
        email: email.toLowerCase().trim(),
      };
      if (code) updates.code = code.toUpperCase().trim();

      const { data: user, error } = await supabase
        .from('users')
        .update(updates)
        .eq('email', originalEmail.toLowerCase().trim())
        .select('name, email, active, created_at')
        .single();

      if (error) return res.status(500).json({ success: false, error: 'Error al actualizar clienta.' });

      return res.json({ success: true, user: publicUser(user) });
    }

    return res.status(400).json({ success: false, error: 'Acción desconocida.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
