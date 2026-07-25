#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.env.SESSION_SECRET = 'test-only-session-secret-with-more-than-24-characters';

const {
  clearSessionCookie,
  readSession,
  safeEqual,
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
setSessionCookie(request, response, { email: 'Prueba@Example.com', name: 'Prueba' });

const setCookie = response.headers['set-cookie'];
assert.match(setCookie, /HttpOnly/);
assert.match(setCookie, /SameSite=Strict/);
assert.match(setCookie, /Secure/);
assert.match(setCookie, /Max-Age=43200/);

const authenticatedRequest = {
  headers: { cookie: cookieValue(setCookie) },
};
assert.deepStrictEqual(readSession(authenticatedRequest).email, 'prueba@example.com');

const tamperedCookie = cookieValue(setCookie).replace(/.$/, (last) => (last === 'a' ? 'b' : 'a'));
assert.strictEqual(readSession({ headers: { cookie: tamperedCookie } }), null);
assert.strictEqual(safeEqual('REVOLUCIONAT', 'REVOLUCIONAT'), true);
assert.strictEqual(safeEqual('REVOLUCIONAT', 'INCORRECTO'), false);

const logoutResponse = responseRecorder();
clearSessionCookie(request, logoutResponse);
assert.match(logoutResponse.headers['set-cookie'], /Max-Age=0/);
assert.match(logoutResponse.headers['set-cookie'], /HttpOnly/);

const indexSource = source('index.html');
const authSource = source('api/auth.js');
const adminSource = source('api/admin.js');
const adminHtmlSource = source('admin.html');

assert.doesNotMatch(indexSource, /localStorage\.setItem\(['"]revolucionat_user/);
assert.match(indexSource, /\/api\/session/);
assert.doesNotMatch(authSource, /Access-Control-Allow-Origin/);
assert.match(authSource, /MAX_ATTEMPTS\s*=\s*6/);
assert.match(authSource, /setSessionCookie/);
assert.doesNotMatch(adminSource, /\.select\(['"][^'"]*\bcode\b/);
assert.match(adminSource, /configured\.length\s*<\s*12/);
assert.doesNotMatch(adminSource, /Access-Control-Allow-Origin/);
assert.match(adminHtmlSource, /Código protegido/);
assert.match(adminHtmlSource, /type="password"[^>]*id="newCode"/);
assert.match(adminHtmlSource, /minlength="8"[^>]*maxlength="64"/);

console.log('✅ Seguridad: cookie firmada, sesión cerrada, rate limit y panel sin códigos expuestos');
