import test from 'node:test';
import assert from 'node:assert/strict';

process.env.APP_KEY = 'a'.repeat(40);
delete process.env.INGEST_KEY;
delete process.env.TOTP_SECRET;

const { setDbForTests } = await import('../api/_lib.js');
const wish = (await import('../api/_routes/wishlist.js')).default;

// 1 = principale, 2 = accessorio di 1, 3 = principale con accessorio 4
const rows = { 1: { parent_id: null }, 2: { parent_id: 1 }, 3: { parent_id: null }, 4: { parent_id: 3 } };
const log = [];
setDbForTests(async (strs, ...v) => {
  const q = strs.join('?').replace(/\s+/g, ' ').trim();
  log.push(q);
  if (q.startsWith('SELECT fails FROM auth_fails')) return [];
  if (q.startsWith('SELECT parent_id FROM wishlist')) return rows[v[0]] ? [rows[v[0]]] : [];
  if (q.startsWith('SELECT id FROM wishlist WHERE parent_id')) return Object.entries(rows).filter(([, r]) => r.parent_id === v[0]).map(([id]) => ({ id: Number(id) }));
  if (q.startsWith('INSERT INTO wishlist')) return [{ id: 50 }];
  if (q.startsWith('UPDATE wishlist SET name')) return [{ id: v[v.length - 1] }];
  return [];
});
const call = async (method, query, body) => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await wish({ method, query, headers: { 'x-app-key': 'a'.repeat(40), 'x-real-ip': '8.8.8.8' }, body }, res);
  return res;
};
const item = (extra) => ({ name: 'Cover', price: 20, priority: 2, installments: 1, ...extra });

test('accorpare a un principale esistente va bene', async () => {
  assert.equal((await call('POST', {}, item({ parent_id: 1 }))).code, 201);
});
test('non si accorpa a un desiderio che non esiste o che è già un accessorio', async () => {
  assert.equal((await call('POST', {}, item({ parent_id: 99 }))).code, 400);
  assert.equal((await call('POST', {}, item({ parent_id: 2 }))).code, 400);
});
test('chi ha già accessori non può diventare accessorio (niente catene o giri)', async () => {
  assert.equal((await call('PUT', { id: '3' }, item({ parent_id: 1 }))).code, 400);
  assert.equal((await call('PUT', { id: '3' }, item({ parent_id: null }))).code, 200);
});
