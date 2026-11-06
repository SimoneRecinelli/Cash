import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.APP_KEY = 'k'.repeat(40);
process.env.TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
process.env.INGEST_KEY = 'ingest-key-123';

const { handler, makeToken, setDbForTests } = await import('../api/_lib.js');
const login = (await import('../api/login.js')).default;

// Database finto: solo ciò che serve ad autenticazione e blocco tentativi
const fails = new Map();
let totpLast = null;
setDbForTests(async (strs, ...v) => {
  const q = strs.join('?').replace(/\s+/g, ' ').trim();
  if (q.startsWith('SELECT fails FROM auth_fails')) { const f = fails.get(v[0]); return f ? [{ fails: f }] : []; }
  if (q.startsWith('INSERT INTO auth_fails')) { fails.set(v[0], (fails.get(v[0]) || 0) + 1); return []; }
  if (q.startsWith('DELETE FROM auth_fails')) { fails.delete(v[0]); return []; }
  if (q.includes('SET totp_last')) { if (totpLast === null || totpLast < v[0]) { totpLast = v[0]; return [{ id: 1 }]; } return []; }
  return [];
});

const app = handler(async (req, res) => res.status(200).json({ ok: 1 }));
const call = async (fn, { headers = {}, body = {}, method = 'POST', ip = '10.0.0.1' } = {}) => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await fn({ headers: { 'x-real-ip': ip, ...headers }, body, method }, res);
  return res;
};

const b32 = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; const bits = [...s].map((c) => A.indexOf(c).toString(2).padStart(5, '0')).join(''); return Buffer.from(bits.match(/.{8}/g).map((x) => parseInt(x, 2))); };
const code = (step) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(step)); const h = createHmac('sha1', b32(process.env.TOTP_SECRET)).update(b).digest(); const o = h[19] & 15; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); };
const step = Math.floor(Date.now() / 30000);

test('senza credenziali: 401', async () => { assert.equal((await call(app, { ip: '1.1.1.1' })).code, 401); });
test('con 2FA attiva la chiave da sola non basta sulle API', async () => {
  assert.equal((await call(app, { headers: { 'x-app-key': process.env.APP_KEY }, ip: '1.1.1.2' })).code, 401);
});
test('login: chiave sbagliata o codice sbagliato → 401', async () => {
  assert.equal((await call(login, { body: { key: 'x', code: code(step) }, ip: '1.1.1.3' })).code, 401);
  assert.equal((await call(login, { body: { key: process.env.APP_KEY, code: '000000' }, ip: '1.1.1.3' })).code, 401);
});
test('login corretto → token valido; il codice non si riusa', async () => {
  const ok = await call(login, { body: { key: process.env.APP_KEY, code: code(step) }, ip: '1.1.1.4' });
  assert.equal(ok.code, 200);
  assert.equal((await call(app, { headers: { 'x-session': ok.body.token }, ip: '1.1.1.4' })).code, 200);
  const again = await call(login, { body: { key: process.env.APP_KEY, code: code(step) }, ip: '1.1.1.4' });
  assert.equal(again.code, 401);
});
test('token manomesso o scaduto → 401', async () => {
  const t = makeToken();
  assert.equal((await call(app, { headers: { 'x-session': t.slice(0, -2) + 'zz' }, ip: '1.1.1.5' })).code, 401);
  assert.equal((await call(app, { headers: { 'x-session': `${Date.now() - 1000}.${'0'.repeat(64)}` }, ip: '1.1.1.5' })).code, 401);
});
test('ingest: solo INGEST_KEY; la chiave principale e il token non valgono', async () => {
  const ing = handler(async (req, res) => res.status(200).json({ ok: 1 }), { auth: 'ingest' });
  assert.equal((await call(ing, { headers: { 'x-app-key': 'ingest-key-123' }, ip: '1.1.1.6' })).code, 200);
  assert.equal((await call(ing, { headers: { 'x-app-key': process.env.APP_KEY }, ip: '1.1.1.6' })).code, 401);
  assert.equal((await call(ing, { headers: { 'x-session': makeToken() }, ip: '1.1.1.6' })).code, 401);
});
test('troppi tentativi sbagliati: blocco 429 anche con credenziali giuste', async () => {
  let r;
  for (let i = 0; i < 10; i++) r = await call(app, { headers: { 'x-session': 'sbagliato' }, ip: '9.9.9.9' });
  assert.equal(r.code, 429);
  assert.equal((await call(app, { headers: { 'x-session': makeToken() }, ip: '9.9.9.9' })).code, 429);
  assert.equal((await call(app, { headers: { 'x-session': makeToken() }, ip: '8.8.8.8' })).code, 200); // altri IP non toccati
});

test('widget: disattivato senza WIDGET_KEY, poi accessibile solo con la sua chiave', async () => {
  const w = handler(async (req, res) => res.status(200).json({ ok: 1 }), { auth: 'widget' });
  delete process.env.WIDGET_KEY;
  assert.equal((await call(w, { headers: { 'x-widget-key': 'qualcosa' }, ip: '3.3.3.1' })).code, 401);
  process.env.WIDGET_KEY = 'widget-key-777';
  assert.equal((await call(w, { headers: { 'x-widget-key': 'widget-key-777' }, ip: '3.3.3.2' })).code, 200);
  assert.equal((await call(w, { headers: { 'x-app-key': process.env.APP_KEY, 'x-session': makeToken() }, ip: '3.3.3.3' })).code, 401);
  assert.equal((await call(app, { headers: { 'x-widget-key': 'widget-key-777' }, ip: '3.3.3.4' })).code, 401); // non apre l’app
});
