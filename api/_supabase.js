const { createClient } = require('@supabase/supabase-js');

function supabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
}

function anonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
}

function clientOptions() {
  return {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  };
}

function authClient() {
  const url = supabaseUrl();
  const key = anonKey();
  if (!url || !key) throw new Error('Supabase Auth no configurado');
  return createClient(url, key, clientOptions());
}

function serviceClient() {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key) throw new Error('Supabase Service Role no configurado');
  return createClient(url, key, clientOptions());
}

async function findAuthUserByEmail(supabase, email) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const found = data.users.find(
      (user) => String(user.email || '').toLowerCase() === normalizedEmail,
    );
    if (found) return found;
    if (data.users.length < 1000) break;
  }
  return null;
}

module.exports = {
  authClient,
  findAuthUserByEmail,
  serviceClient,
};
