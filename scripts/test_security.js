#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.env.SESSION_SECRET = 'test-only-session-secret-with-more-than-24-characters';

const {
  clearAdminSessionCookie,
  clearSessionCookie,
  readAdminSession,
  readSession,
  safeEqual,
  setAdminSessionCookie,
  setSessionCookie,
} = require('../api/_session');

function responseRecorder() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
  };
}

function cookieValue(setCookie) {
  return String(setCookie).split(';')[0];
}

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

const request = {
  headers: { 'x-forwarded-proto': 'https' },
};
const response = responseRecorder();
setSessionCookie(request, response, {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'Prueba@Example.com',
  name: 'Prueba',
});

const setCookie = response.headers['set-cookie'];
assert.match(setCookie, /HttpOnly/);
assert.match(setCookie, /SameSite=Strict/);
assert.match(setCookie, /Secure/);
assert.match(setCookie, /Max-Age=31536000/);

const authenticatedRequest = {
  headers: { cookie: cookieValue(setCookie) },
};
assert.deepStrictEqual(readSession(authenticatedRequest).email, 'prueba@example.com');
assert.deepStrictEqual(
  readSession(authenticatedRequest).sub,
  '00000000-0000-0000-0000-000000000001',
);
assert.deepStrictEqual(readSession(authenticatedRequest).version, 1);

const tamperedCookie = cookieValue(setCookie).replace(/.$/, (last) => (last === 'a' ? 'b' : 'a'));
assert.strictEqual(readSession({ headers: { cookie: tamperedCookie } }), null);
assert.strictEqual(safeEqual('REVOLUCIONAT', 'REVOLUCIONAT'), true);
assert.strictEqual(safeEqual('REVOLUCIONAT', 'INCORRECTO'), false);

const logoutResponse = responseRecorder();
clearSessionCookie(request, logoutResponse);
assert.match(logoutResponse.headers['set-cookie'], /Max-Age=0/);
assert.match(logoutResponse.headers['set-cookie'], /HttpOnly/);

const adminResponse = responseRecorder();
setAdminSessionCookie(request, adminResponse, {
  id: '00000000-0000-0000-0000-000000000002',
  email: 'admin@example.com',
});
assert.match(adminResponse.headers['set-cookie'], /revolucionat_admin_session=/);
assert.match(adminResponse.headers['set-cookie'], /Max-Age=14400/);
assert.strictEqual(readSession({
  headers: { cookie: cookieValue(adminResponse.headers['set-cookie']) },
}), null);
assert.strictEqual(readAdminSession({
  headers: { cookie: cookieValue(adminResponse.headers['set-cookie']) },
}).email, 'admin@example.com');
const adminLogoutResponse = responseRecorder();
clearAdminSessionCookie(request, adminLogoutResponse);
assert.match(adminLogoutResponse.headers['set-cookie'], /Max-Age=0/);

const indexSource = source('index.html');
const authSource = source('api/auth.js');
const adminSource = source('api/admin.js');
const adminHtmlSource = source('admin.html');
const adminAuthSource = source('api/admin-auth.js');
const serviceWorkerSource = source('service-worker.js');
const brandAssets = [
  'assets/brand/logo-revolucionat-cropped.webp',
  'assets/brand/bricolage-grotesque-latin.woff2',
  'assets/brand/manrope-latin.woff2',
  'icon-192.png',
  'icon-512.png',
];

assert.doesNotMatch(indexSource, /localStorage\.setItem\(['"]revolucionat_user/);
assert.doesNotMatch(indexSource, /localStorage\.setItem\([^)]*exchange/i);
assert.match(indexSource, /\/api\/session/);
assert.match(indexSource, /EXCHANGE_RESULT_CACHE_LIMIT\s*=\s*18/);
assert.match(indexSource, /type="password"\s+id="passwordInput"/);
assert.match(indexSource, /id="passwordToggle"/);
assert.match(indexSource, /recordará tu acceso durante un año/);
assert.doesNotMatch(indexSource, /text-transform:\s*uppercase[^}]*passwordInput/);
assert.doesNotMatch(authSource, /Access-Control-Allow-Origin/);
assert.match(authSource, /MAX_ATTEMPTS\s*=\s*6/);
assert.match(authSource, /setSessionCookie/);
assert.match(authSource, /signInWithPassword/);
assert.doesNotMatch(authSource, /\.select\(['"][^'"]*\bcode\b/);
assert.doesNotMatch(adminSource, /Access-Control-Allow-Origin/);
assert.doesNotMatch(adminSource, /ADMIN_PASSWORD|x-admin-password/);
assert.match(adminSource, /auth\.admin\.createUser/);
assert.match(adminSource, /app_metadata:\s*\{\s*role:\s*'member'/);
assert.match(adminSource, /value\.length\s*>=\s*12/);
assert.match(adminAuthSource, /app_metadata\?\.role\s*!==\s*'admin'/);
assert.match(adminHtmlSource, /Contraseña protegida/);
assert.match(adminHtmlSource, /type="password"[^>]*id="newPassword"/);
assert.match(adminHtmlSource, /minlength="12"[^>]*maxlength="128"/);
assert.match(adminHtmlSource, /id="adminEmail"/);
assert.doesNotMatch(adminHtmlSource, /sessionStorage|x-admin-password/);
assert.match(serviceWorkerSource, /isDocument/);
assert.match(serviceWorkerSource, /self\.clients\.claim/);
assert.match(serviceWorkerSource, /revolucionat-premium-v2-2-ux-1/);
brandAssets.forEach((asset) => assert.ok(fs.existsSync(path.join(ROOT, asset)), `${asset} no existe`));

console.log('✅ Seguridad: Supabase Auth, cookies separadas, baja inmediata y panel sin contraseñas expuestas');
