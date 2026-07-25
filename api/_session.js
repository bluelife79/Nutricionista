const crypto = require('crypto');

const COOKIE_NAME = 'revolucionat_session';
const SESSION_SECONDS = 12 * 60 * 60;

function sessionSecret() {
  const raw = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw || raw.length < 24) {
    throw new Error('SESSION_SECRET no configurado');
  }
  return crypto.createHash('sha256').update(`revolucionat:${raw}`).digest();
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function signSession(profile) {
  const payload = encode(JSON.stringify({
    email: String(profile.email || '').toLowerCase().trim(),
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  }));
  const signature = crypto
    .createHmac('sha256', sessionSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto
    .createHmac('sha256', sessionSecret())
    .update(payload)
    .digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.email || !decoded.exp || decoded.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const index = item.indexOf('=');
      if (index > 0) {
        cookies[item.slice(0, index)] = decodeURIComponent(item.slice(index + 1));
      }
      return cookies;
    }, {});
}

function isSecure(req) {
  return process.env.NODE_ENV === 'production' ||
    String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function setSessionCookie(req, res, profile) {
  const secure = isSecure(req) ? '; Secure' : '';
  const token = signSession(profile);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`,
  );
}

function clearSessionCookie(req, res) {
  const secure = isSecure(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  );
}

function readSession(req) {
  return verifySession(parseCookies(req)[COOKIE_NAME]);
}

module.exports = {
  clearSessionCookie,
  readSession,
  safeEqual,
  setSessionCookie,
};
