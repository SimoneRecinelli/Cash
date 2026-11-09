import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.APP_KEY = 'd'.repeat(40);
delete process.env.TOTP_SECRET;
const { setDbForTests } = await import('../api/_lib.js');
const { default: hub, routes } = await import('../api/hub.js');

const apiDir = new URL('../api/', import.meta.url).pathname;
const functions = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name.startsWith('_')) return []; // Vercel ignora ciò che inizia con _
  const p = path.join(dir, e.name);
  return e.isDirectory() ? functions(p, rel + e.name + '/') : e.name.endsWith('.js') ? [rel + e.name] : [];
});

test('Vercel (piano gratuito): al massimo 12 funzioni in api/', () => {
  const f = functions(apiDir);
  assert.ok(f.length <= 12, `Troppe funzioni (${f.length}): ${f.join(', ')}`);
});

test('il frontend instrada verso l’hub esattamente le rotte che l’hub conosce', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const m = html.match(/const HUB = new Set\(\[(.*?)\]\)/);
  assert.ok(m, 'HUB non trovato in index.html');
  const inFront = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
  assert.deepEqual(inFront, Object.keys(routes).sort());
  // nessuna rotta dell'hub deve esistere anche come funzione a sé
  const standalone = functions(apiDir).map((x) => x.replace('.js', ''));
  for (const r of Object.keys(routes)) assert.ok(!standalone.includes(r), `${r} è sia hub sia funzione`);
});

const call = async (query, method = 'GET', body = {}) => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await hub({ method, query, body, headers: { 'x-app-key': process.env.APP_KEY, 'x-real-ip': '6.6.6.6' } }, res);
  return res;
};
setDbForTests(async (strs) => {
  const q = strs.join('?').replace(/\s+/g, ' ').trim();
  if (q.startsWith('SELECT fails FROM auth_fails')) return [];
  if (q.includes('FROM wishlist')) return [{ id: 1, name: 'iPad' }];
  return [];
});

test('hub: rotta sconosciuta → 404; rotta nota → arriva al suo handler, con autenticazione', async () => {
  assert.equal((await call({ r: 'nonesiste' })).code, 404);
  assert.equal((await call({})).code, 404);
  const ok = await call({ r: 'wishlist' });
  assert.equal(ok.code, 200);
  assert.deepEqual(ok.body.items, [{ id: 1, name: 'iPad' }]);
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await hub({ method: 'GET', query: { r: 'wishlist' }, headers: { 'x-real-ip': '6.6.6.7' } }, res); // senza credenziali
  assert.equal(res.code, 401);
});

test('le pagine HTML e sim-core.js non hanno errori di sintassi (una pagina vuota = app inutilizzabile)', async () => {
  const vm = await import('node:vm');
  const pub = new URL('../public/', import.meta.url);
  for (const f of fs.readdirSync(pub).filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(new URL(f, pub), 'utf8');
    [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].forEach((m, i) => {
      assert.doesNotThrow(() => new vm.Script(m[1], { filename: `${f}#script${i}` }), `${f}: errore di sintassi nello script ${i}`);
    });
  }
  for (const f of fs.readdirSync(pub).filter((n) => n.endsWith('.js'))) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(new URL(f, pub), 'utf8'), { filename: f }), `${f}: errore di sintassi`);
  }
});
