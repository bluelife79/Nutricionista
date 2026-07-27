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
const sessionSource = source('api/_session.js');
const rateLimitSource = source('api/_rate_limit.js');
const auditSource = source('api/_audit.js');
const securityMigrationSource = source(
  'supabase/migrations/202607270001_security_controls.sql',
);
const serviceWorkerSource = source('service-worker.js');
const vercelConfig = JSON.parse(source('vercel.json'));
const versionManifest = JSON.parse(source('version.json'));
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
assert.match(indexSource, /Solo tendrás que escribirla esta primera vez/);
assert.match(
  indexSource,
  /Mientras formes parte del programa, no tendrás que volver a identificarte/,
);
assert.doesNotMatch(indexSource, /text-transform:\s*uppercase[^}]*passwordInput/);
assert.doesNotMatch(indexSource, /user-scalable\s*=\s*no/);
assert.doesNotMatch(adminHtmlSource, /user-scalable\s*=\s*no/);
assert.match(indexSource, /function escapeHtml\(value\)/);
assert.match(indexSource, /data-food-id="\$\{escapeHtml\(food\.id\)\}"/);
assert.match(indexSource, /\$\{escapeHtml\(originalFood\.name\)\}/);
assert.match(indexSource, /\$\{escapeHtml\(alt\.name\)\}/);
assert.doesNotMatch(indexSource, /\$\{originalFood\.name\}/);
assert.doesNotMatch(indexSource, /\$\{alt\.name\}/);
const htmlSafetySource = indexSource.match(
  /function highlightMatch\(text, query\) \{[\s\S]*?function escapeHtml\(value\) \{[\s\S]*?\n      \}/,
);
assert.ok(htmlSafetySource, 'No se pudieron aislar las funciones de salida segura');
const htmlSafety = new Function(
  `${htmlSafetySource[0]}; return { escapeHtml, highlightMatch };`,
)();
const maliciousName = '<img src=x onerror="globalThis.pwned=true">Pollo';
assert.strictEqual(
  htmlSafety.escapeHtml(maliciousName),
  '&lt;img src=x onerror=&quot;globalThis.pwned=true&quot;&gt;Pollo',
);
assert.doesNotMatch(htmlSafety.highlightMatch(maliciousName, 'pollo'), /<img/i);
assert.match(htmlSafety.highlightMatch(maliciousName, 'pollo'), /<strong>Pollo<\/strong>/);
assert.doesNotMatch(sessionSource, /SESSION_SECRET\s*\|\|/);
assert.doesNotMatch(sessionSource, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(authSource, /Access-Control-Allow-Origin/);
assert.match(rateLimitSource, /MAX_ATTEMPTS\s*=\s*6/);
assert.match(rateLimitSource, /consume_auth_rate_limit/);
assert.doesNotMatch(authSource, /new Map/);
assert.doesNotMatch(adminAuthSource, /new Map/);
assert.match(authSource, /setSessionCookie/);
assert.match(authSource, /signInWithPassword/);
assert.doesNotMatch(authSource, /\.select\(['"][^'"]*\bcode\b/);
assert.doesNotMatch(adminSource, /Access-Control-Allow-Origin/);
assert.doesNotMatch(adminSource, /ADMIN_PASSWORD|x-admin-password/);
assert.match(adminSource, /auth\.admin\.createUser/);
assert.match(adminSource, /app_metadata:\s*\{\s*role:\s*'member'/);
assert.match(adminSource, /value\.length\s*>=\s*12/);
assert.match(adminAuthSource, /app_metadata\?\.role\s*!==\s*'admin'/);
assert.match(adminAuthSource, /sessionVersion/);
assert.match(adminSource, /session\.version/);
assert.match(auditSource, /admin_audit_log/);
assert.match(securityMigrationSource, /enable row level security/);
assert.match(securityMigrationSource, /consume_auth_rate_limit/);
assert.match(securityMigrationSource, /admin_audit_log/);
assert.match(adminHtmlSource, /Contraseña protegida/);
assert.match(adminHtmlSource, /type="password"[^>]*id="newPassword"/);
assert.match(adminHtmlSource, /minlength="12"[^>]*maxlength="128"/);
assert.match(adminHtmlSource, /id="adminEmail"/);
assert.doesNotMatch(adminHtmlSource, /sessionStorage|x-admin-password/);
assert.match(serviceWorkerSource, /isDocument/);
assert.match(serviceWorkerSource, /self\.clients\.claim/);
assert.match(serviceWorkerSource, /revolucionat-premium-v2-4-rc-1/);
const globalHeaders = vercelConfig.headers.find((entry) => entry.source === '/(.*)');
assert.ok(globalHeaders, 'Faltan cabeceras globales');
const headerMap = Object.fromEntries(
  globalHeaders.headers.map((header) => [header.key.toLowerCase(), header.value]),
);
assert.match(headerMap['content-security-policy'], /frame-ancestors 'none'/);
assert.strictEqual(headerMap['x-content-type-options'], 'nosniff');
assert.strictEqual(headerMap['x-frame-options'], 'DENY');
assert.ok(headerMap['referrer-policy']);
assert.ok(headerMap['permissions-policy']);
assert.strictEqual(versionManifest.base_commit, 'd8ddbea434c9a9bc62a4257f28ec13d76dd4943c');
assert.strictEqual(versionManifest.catalog_records, 5324);
brandAssets.forEach((asset) => assert.ok(fs.existsSync(path.join(ROOT, asset)), `${asset} no existe`));

console.log('✅ Seguridad: sesión independiente, salida HTML protegida, zoom disponible y cabeceras defensivas');
