import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { computeSummary } from '../api/_calc.js';
import { fixture, input } from './helpers.mjs';

vm.runInThisContext(fs.readFileSync(new URL('../public/sim-core.js', import.meta.url), 'utf8'));
const { schedule, analyse, plan } = globalThis.SimCore;

const data = (over) => computeSummary(input(fixture(over)));
const item = (id, price, priority = 2, installments = 1, extra = {}) => ({ id, name: 'Voce ' + id, price, priority, installments, created: '2026-11-0' + id, ...extra });
const byId = (r, id) => r.find((x) => x.id === id).plan;

const small = (d, k = 0.6) => Math.floor(d.totals.remaining * k);

test('un acquisto piccolo regge subito; uno che supera quanto resta nel periodo slitta al prossimo stipendio', () => {
  const d = data();
  const ok = byId(schedule(d, [item(1, small(d))]), 1);
  assert.equal(ok.status, 'now');
  assert.equal(ok.start, '2026-11-05');
  const big = byId(schedule(d, [item(1, 100)]), 1); // obiettivi ok, ma nel periodo restano ~22 €
  assert.equal(big.status, 'nextperiod');
  assert.equal(big.start, '2026-11-09');
});

test('iPad da 800 € in 3 rate: non regge a dicembre, parte dal 1° gennaio — come dice il simulatore', () => {
  const d = data();
  const p = byId(schedule(d, [item(1, 800, 1, 3)]), 1);
  assert.equal(p.status, 'later');
  assert.equal(p.start, '2027-01-01');
  assert.equal(p.last, '2027-03-01');
  const a = analyse(d, 800, 3, 0);
  assert.equal(a.level, 'no');
  assert.equal(a.alt.when.s, '2027-01-01'); // stessa risposta della pagina Simula
});

test('la priorità decide chi si prende il margine per primo', () => {
  const d = data(), p = small(d);
  const a = schedule(d, [item(1, p, 1), item(2, p, 2)]);
  assert.equal(byId(a, 1).status, 'now');
  assert.notEqual(byId(a, 2).start, byId(a, 1).start); // il secondo deve aspettare
  const b = schedule(d, [item(1, p, 2), item(2, p, 1)]);
  assert.equal(byId(b, 2).status, 'now'); // scambiando le priorità si scambia l'ordine
  assert.ok(byId(b, 1).start > byId(b, 2).start);
});

test('a parità di priorità vale l’ordine di inserimento', () => {
  const r = schedule(data(), [item(2, 300, 2), item(1, 300, 2)]);
  assert.deepEqual(r.map((x) => x.id), [1, 2]);
});

test('un acquisto enorme finisce dopo l’ultimo obiettivo', () => {
  const p = byId(schedule(data(), [item(1, 20000)]), 1);
  assert.equal(p.status, 'free');
  assert.equal(p.start, '2027-07-01');
});

test('un desiderio non passato al calendario non pesa sugli altri', () => {
  const d = data(), p = small(d);
  assert.equal(byId(schedule(d, [item(2, p, 2)]), 2).status, 'now');
  assert.notEqual(byId(schedule(d, [item(1, p, 1), item(2, p, 2)]), 2).status, 'now');
});

test('senza obiettivi conta solo quanto resta in questo periodo', () => {
  const d = data({ goalRows: [] });
  const rem = d.totals.remaining;
  assert.equal(byId(schedule(d, [item(1, Math.floor(rem) - 1)]), 1).status, 'now');
  assert.equal(byId(schedule(d, [item(1, Math.ceil(rem) + 500)]), 1).status, 'nextperiod');
});

test('i margini restituiti sono quelli dopo gli acquisti precedenti', () => {
  const d = data();
  const [a, b] = schedule(d, [item(1, 20, 1), item(2, 20, 2)]);
  assert.ok(b.plan.margin < a.plan.margin);
  assert.ok(Math.abs((a.plan.margin - b.plan.margin) - 20) < 1);
});

// ---- Link e API ----
import { cleanUrl } from '../api/_routes/wishlist.js';

test('link: solo http/https; senza schema aggiunge https', () => {
  assert.equal(cleanUrl('amazon.it/dp/B0ABC').v, 'https://amazon.it/dp/B0ABC');
  assert.equal(cleanUrl('https://www.backmarket.it/it-it/p/ipad').v, 'https://www.backmarket.it/it-it/p/ipad');
  assert.equal(cleanUrl('').v, '');
  assert.ok(cleanUrl('javascript:alert(1)').error);
  assert.ok(cleanUrl('data:text/html,<script>x</script>').error);
  assert.ok(cleanUrl('ftp://x.it/file').error);
  assert.ok(cleanUrl('https://' + 'a'.repeat(600) + '.it').error);
});

process.env.APP_KEY = 'w'.repeat(40);
delete process.env.TOTP_SECRET;
const { setDbForTests } = await import('../api/_lib.js');
const wishlist = (await import('../api/_routes/wishlist.js')).default;
const inserted = [];
setDbForTests(async (strs, ...v) => {
  const q = strs.join('?').replace(/\s+/g, ' ').trim();
  if (q.startsWith('SELECT fails FROM auth_fails')) return [];
  if (q.startsWith('INSERT INTO wishlist')) { inserted.push(v); return [{ id: 1 }]; }
  return [];
});
const call = async (method, body, query = {}) => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await wishlist({ method, body, query, headers: { 'x-app-key': process.env.APP_KEY, 'x-real-ip': '7.7.7.7' } }, res);
  return res;
};

test('API: crea un desiderio valido, rifiuta link o dati non validi', async () => {
  assert.equal((await call('POST', { name: 'iPad', price: 764.49, url: 'https://www.backmarket.it/x', priority: 1, installments: 3 })).code, 201);
  assert.equal(inserted.length, 1);
  assert.equal((await call('POST', { name: 'iPad', price: 100, url: 'javascript:alert(1)' })).code, 400);
  assert.equal((await call('POST', { name: '', price: 100 })).code, 400);
  assert.equal((await call('POST', { name: 'x', price: -5 })).code, 400);
  assert.equal((await call('POST', { name: 'x', price: 5, priority: 9 })).code, 400);
  assert.equal((await call('POST', { name: 'x', price: 5, installments: 0 })).code, 400);
  assert.equal(inserted.length, 1);
});
