const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, code } = req.body || {};

  if (!email || !code) {
    return res.status(400).json({ success: false, error: 'Completá todos los campos.' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('name, email, code, active')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error || !user) {
    return res.status(401).json({ success: false, error: 'No encontramos tu cuenta. Verificá tu email.' });
  }

  if (user.code !== code.toUpperCase().trim()) {
    return res.status(401).json({ success: false, error: 'Código incorrecto.' });
  }

  if (!user.active) {
    return res.status(403).json({ success: false, error: 'Tu acceso fue desactivado. Contactá a tu nutricionista.' });
  }

  return res.json({ success: true, name: user.name, email: user.email });
};
