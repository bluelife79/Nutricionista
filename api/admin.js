const { findAuthUserByEmail, serviceClient } = require('./_supabase');
const { readAdminSession } = require('./_session');
const { logAdminAction } = require('./_audit');

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
  if (
    Number(user.app_metadata?.session_version || 1) !==
    Number(session.version || 1)
  ) return null;
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

function adminError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  return error;
}

async function recordAdminAction(
  supabase,
  adminUser,
  action,
  targetEmail,
  metadata,
) {
  try {
    await logAdminAction(
      supabase,
      adminUser,
      action,
      targetEmail,
      metadata,
    );
    return null;
  } catch (error) {
    // La auditoría es importante, pero un fallo puntual de su tabla no debe
    // convertir una baja ya aplicada en un falso error para el administrador.
    console.error('admin_audit_log_failed', action, error?.message || 'unknown');
    return 'El cambio se aplicó, aunque no pudimos guardar su registro interno.';
  }
}

async function setMemberActive(supabase, email, desiredActive) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  if (!normalizedEmail || typeof desiredActive !== 'boolean') {
    throw adminError(400, 'Indica la clienta y el estado que quieres aplicar.');
  }

  const { data: current, error: currentError } = await supabase
    .from('users')
    .select('name, email, active, created_at')
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (currentError) {
    throw adminError(500, 'No hemos podido comprobar el estado de la clienta.');
  }
  if (!current) {
    throw adminError(404, 'Clienta no encontrada.');
  }
  if (Boolean(current.active) === desiredActive) {
    return { user: current, changed: false, sessionRevoked: false };
  }

  let authUser;
  try {
    authUser = await findAuthUserByEmail(supabase, normalizedEmail);
  } catch {
    throw adminError(503, 'No hemos podido comprobar su cuenta de acceso.');
  }

  // Dar de baja un perfil sin cuenta Auth vinculada sigue siendo seguro: no
  // existe una sesión que revocar. Para reactivarlo sí exigimos una cuenta.
  if (!authUser && desiredActive) {
    throw adminError(
      409,
      'Esta clienta no tiene una cuenta de acceso vinculada. Edítala antes de activarla.',
    );
  }

  const previousMetadata = authUser
    ? { ...(authUser.app_metadata || {}) }
    : null;
  let authChanged = false;
  if (authUser) {
    const currentVersion = Number(authUser.app_metadata?.session_version || 1);
    const nextMetadata = {
      ...(authUser.app_metadata || {}),
      role: 'member',
      session_version: desiredActive ? currentVersion : currentVersion + 1,
    };
    const authUpdate = await supabase.auth.admin.updateUserById(authUser.id, {
      app_metadata: nextMetadata,
    });
    if (authUpdate.error) {
      throw adminError(
        503,
        desiredActive
          ? 'No hemos podido preparar de nuevo su acceso.'
          : 'No hemos podido cerrar sus sesiones. La baja no se ha aplicado.',
      );
    }
    authChanged = true;
  }

  const { data: user, error: profileError } = await supabase
    .from('users')
    .update({ active: desiredActive })
    .eq('email', normalizedEmail)
    .select('name, email, active, created_at')
    .single();

  if (profileError || !user) {
    if (authChanged) {
      await supabase.auth.admin.updateUserById(authUser.id, {
        app_metadata: previousMetadata,
      });
    }
    throw adminError(
      500,
      'No hemos podido guardar el nuevo estado. No se ha aplicado ningún cambio.',
    );
  }

  return {
    user,
    changed: true,
    sessionRevoked: Boolean(authUser && !desiredActive),
  };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let supabase;
  let adminUser;
  try {
    supabase = serviceClient();
    adminUser = await authorizedAdmin(req, supabase);
  } catch {
    return res.status(503).json({
      success: false,
      error: 'No hemos podido conectar con la administración. Inténtalo de nuevo.',
    });
  }
  if (!adminUser) {
    return res.status(401).json({
      success: false,
      error: 'Tu sesión de administración ha caducado. Vuelve a identificarte.',
    });
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
        app_metadata: { role: 'member', session_version: 1 },
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
      const warning = await recordAdminAction(
        supabase,
        adminUser,
        'member_created',
        normalizedEmail,
        { active: true },
      );
      return res.json({
        success: true,
        user: publicUser(user),
        warning,
      });
    }

    if (action === 'toggle' || action === 'set_active') {
      const normalizedEmail = String(email || '').toLowerCase().trim();
      let desiredActive = req.body?.active;
      if (action === 'toggle') {
        const { data: current, error } = await supabase
          .from('users')
          .select('active')
          .eq('email', normalizedEmail)
          .maybeSingle();
        if (error) {
          return res.status(500).json({
            success: false,
            error: 'No hemos podido comprobar el estado de la clienta.',
          });
        }
        if (!current) {
          return res.status(404).json({
            success: false,
            error: 'Clienta no encontrada.',
          });
        }
        desiredActive = !current.active;
      }

      let lifecycle;
      try {
        lifecycle = await setMemberActive(
          supabase,
          normalizedEmail,
          desiredActive,
        );
      } catch (error) {
        return res.status(error.status || 500).json({
          success: false,
          error: error.publicMessage || 'No hemos podido cambiar el estado.',
        });
      }
      const warning = lifecycle.changed
        ? await recordAdminAction(
        supabase,
        adminUser,
            desiredActive ? 'member_reactivated' : 'member_deactivated',
        normalizedEmail,
            {
              active: desiredActive,
              session_revoked: lifecycle.sessionRevoked,
            },
          )
        : null;
      return res.json({
        success: true,
        user: publicUser(lifecycle.user),
        changed: lifecycle.changed,
        warning,
      });
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
          session_version: password
            ? Number(authUser.app_metadata?.session_version || 1) + 1
            : Number(authUser.app_metadata?.session_version || 1),
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
      const warning = await recordAdminAction(
        supabase,
        adminUser,
        'member_updated',
        normalizedEmail,
        {
          previous_email: originalEmail,
          password_changed: Boolean(password),
        },
      );
      return res.json({
        success: true,
        user: publicUser(user),
        warning,
      });
    }

    return res.status(400).json({ success: false, error: 'Acción desconocida.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = handler;
module.exports._test = {
  setMemberActive,
};
