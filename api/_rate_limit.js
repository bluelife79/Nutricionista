const crypto = require('crypto');

const WINDOW_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 6;

function requestFingerprint(req, email) {
  const ip = String(
    req.headers['x-forwarded-for'] ||
      req.socket?.remoteAddress ||
      'unknown',
  )
    .split(',')[0]
    .trim();
  return crypto
    .createHash('sha256')
    .update(`${ip}:${String(email || '').toLowerCase().trim()}`)
    .digest('hex');
}

async function consumeRateLimit(supabase, req, email, scope) {
  const { data, error } = await supabase.rpc('consume_auth_rate_limit', {
    p_key: requestFingerprint(req, email),
    p_scope: String(scope || 'login'),
    p_window_seconds: WINDOW_SECONDS,
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (error) throw error;
  return data === true;
}

async function clearRateLimit(supabase, req, email, scope) {
  const { error } = await supabase
    .from('auth_rate_limits')
    .delete()
    .eq('key_hash', requestFingerprint(req, email))
    .eq('scope', String(scope || 'login'));
  if (error) throw error;
}

module.exports = {
  MAX_ATTEMPTS,
  clearRateLimit,
  consumeRateLimit,
};
