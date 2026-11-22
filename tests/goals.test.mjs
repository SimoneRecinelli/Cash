import test from 'node:test';
import assert from 'node:assert/strict';

process.env.APP_KEY = 'a'.repeat(40);
delete process.env.INGEST_KEY;
delete process.env.TOTP_SECRET;

const { setDbForTests } = await import('../api/_lib.js');
const goals = (await import('../api/_routes/goals.js')).default;

const log = [];
let found = true;
setDbForTests(async (strs, ...v) => {
  const q = strs.join('?').replace(/\s+/g, ' ').trim();
  log.push([q, v]);
  if (q.startsWith('SELECT fails FROM auth_fails')) return [];
  if (q.startsWith('UPDATE goals')) return found ? [{ id: v[v.length - 1] }] : [];
  return [];
});
const call = async (method, query, body) => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await goals({ method, query, headers: { 'x-app-key': 'a'.repeat(40), 'x-real-ip': '7.7.7.7' }, body }, res);
  return res;
};

test('modifica obiettivo: cambia la cifra e lascia la data', async () => {
  log.length = 0; found = true;
  const r = await call('PUT', { id: '3' }, { amount: 13500 });
  assert.equal(r.code, 200);
  const q = log.find(([x]) => x.startsWith('UPDATE goals'));
  assert.ok(q[0].includes('SET amount') && !q[0].includes('date ='));
  assert.deepEqual(q[1], [13500, 3]);
});

test('modifica obiettivo: cifra e data insieme; valori non validi rifiutati', async () => {
  log.length = 0; found = true;
  assert.equal((await call('PUT', { id: '3' }, { amount: 14000, date: '2026-12-31' })).code, 200);
  assert.equal((await call('PUT', { id: '3' }, { amount: -5 })).code, 400);
  assert.equal((await call('PUT', { id: '3' }, { amount: 100, date: '31/12/2026' })).code, 400);
  assert.equal((await call('PUT', { id: 'x' }, { amount: 100 })).code, 400);
});

test('modifica obiettivo: id inesistente → 404', async () => {
  found = false;
  assert.equal((await call('PUT', { id: '99' }, { amount: 100 })).code, 404);
});
