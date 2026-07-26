const { findAuthUserByEmail, serviceClient } = require('./_supabase');
const { readAdminSession } = require('./_session');

function validIdentity(name, email) {
  const normalizedName = String(name || '').trim();
  const normalizedEmail = String(email || '').toLowerCase().trim();
  return normalizedName.length >= 2 &&
    normalizedName.length <= 120 &&
    normalizedEmail.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
}

function validPassword(password) {
  const value = String(password || '');
  return value.length >= 12 &&
    value.length <= 128 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value);
}

async function authorizedAdmin(req, supabase) {
  let session;
  try {
    session = readAdminSession(req);
  } catch {
    return null;
  }
  if (!session?.sub) return null;
  const { data, error } = await supabase.auth.admin.getUserById(session.sub);
  const user = data?.user;
  if (error || !user || user.app_metadata?.role !== 'admin') return null;
  if (String(user.email || '').toLowerCase() !== session.email) return null;
  return user;
}

function publicUser(user) {
  if (!user) return user;
  return {
    name: user.name,
    email: user.email,
    active: user.active,
    created_at: user.created_at,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = serviceClient();
  if (!await authorizedAdmin(req, supabase)) {
    return res.status(401).json({ success: false, error: 'No autorizado.' });
  }

  if (req.method === 'GET') {
    const { data: users, error } = await supabase
      .from('users')
      .select('name, email, active, created_at')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ success: false, error: 'Error al cargar clientas.' });
    return res.json({ success: true, users: users.map(publicUser) });
  }

  if (req.method === 'POST') {
    const { action, email, name, password } = req.body || {};

    if (action === 'create') {
      if (!validIdentity(name, email) || !validPassword(password)) {
        return res.status(400).json({
          success: false,
          error: 'Revisa nombre, email y contraseña (12 caracteres, mayúscula, minúscula y número).',
        });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const { data: existingProfile } = await supabase
        .from('users')
        .select('email')
        .eq('email', normalizedEmail)
        .maybeSingle();
      const existingAuth = await findAuthUserByEmail(supabase, normalizedEmail);
      if (existingProfile || existingAuth) {
        return res.status(409).json({ success: false, error: 'Ya existe una clienta con ese email.' });
      }

      const authResult = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: { name: name.trim() },
        app_metadata: { role: 'member' },
      });
      if (authResult.error || !authResult.data.user) {
        return res.status(400).json({ success: false, error: 'No se ha podido crear la cuenta de acceso.' });
      }

      const authUser = authResult.data.user;
      const { data: user, error } = await supabase
        .from('users')
        .insert({
          name: name.trim(),
          email: normalizedEmail,
          code: `AUTH:${authUser.id}`,
          active: true,
        })
        .select('name, email, active, created_at')
        .single();

      if (error) {
        await supabase.auth.admin.deleteUser(authUser.id);
        return res.status(400).json({ success: false, error: 'No se ha podido crear el perfil de la clienta.' });
      }
      return res.json({ success: true, user: publicUser(user) });
    }

    if (action === 'toggle') {
      const normalizedEmail = String(email || '').toLowerCase().trim();
      if (!normalizedEmail) {
        return res.status(400).json({ success: false, error: 'Email requerido.' });
      }

      const { data: current } = await supabase
        .from('users')
        .select('active')
        .eq('email', normalizedEmail)
        .single();
      if (!current) {
        return res.status(404).json({ success: false, error: 'Clienta no encontrada.' });
      }

      const { data: user, error } = await supabase
        .from('users')
        .update({ active: !current.active })
        .eq('email', normalizedEmail)
        .select('name, email, active, created_at')
        .single();
      if (error) return res.status(500).json({ success: false, error: 'Error al cambiar estado.' });
      return res.json({ success: true, user: publicUser(user) });
    }

    if (action === 'update') {
      const originalEmail = String(req.body?.originalEmail || '').toLowerCase().trim();
      const normalizedEmail = String(email || '').toLowerCase().trim();
      if (!originalEmail || !validIdentity(name, normalizedEmail) ||
          (password && !validPassword(password))) {
        return res.status(400).json({
          success: false,
          error: 'Revisa nombre, email y la nueva contraseña.',
        });
      }

      const authUser = await findAuthUserByEmail(supabase, originalEmail);
      if (!authUser) {
        return res.status(404).json({
          success: false,
          error: 'Esta clienta no tiene una cuenta de acceso vinculada.',
        });
      }

      const authUpdates = {
        email: normalizedEmail,
        email_confirm: true,
        user_metadata: {
          ...(authUser.user_metadata || {}),
          name: name.trim(),
        },
        app_metadata: {
          ...(authUser.app_metadata || {}),
          role: 'member',
        },
      };
      if (password) authUpdates.password = password;

      const authUpdate = await supabase.auth.admin.updateUserById(authUser.id, authUpdates);
      if (authUpdate.error) {
        return res.status(400).json({
          success: false,
          error: 'No se ha podido actualizar la cuenta de acceso. Comprueba que el email no esté repetido.',
        });
      }

      const { data: user, error } = await supabase
        .from('users')
        .update({
          name: name.trim(),
          email: normalizedEmail,
          code: `AUTH:${authUser.id}`,
        })
        .eq('email', originalEmail)
        .select('name, email, active, created_at')
        .single();

      if (error) {
        await supabase.auth.admin.updateUserById(authUser.id, {
          email: originalEmail,
          email_confirm: true,
          user_metadata: authUser.user_metadata,
        });
        return res.status(500).json({ success: false, error: 'Error al actualizar el perfil.' });
      }
      return res.json({ success: true, user: publicUser(user) });
    }

    return res.status(400).json({ success: false, error: 'Acción desconocida.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
