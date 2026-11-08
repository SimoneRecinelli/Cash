import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, extractPrice, safeToFetch, fetchPrice } from '../api/_price.js';

test('parsePrice: formati italiani e inglesi', () => {
  assert.equal(parsePrice('13,99 €'), 13.99);
  assert.equal(parsePrice('1.299,00'), 1299);
  assert.equal(parsePrice('1,299.50'), 1299.5);
  assert.equal(parsePrice('689'), 689);
  assert.equal(parsePrice('€ 689.00'), 689);
  assert.equal(parsePrice('gratis'), null);
  assert.equal(parsePrice('0'), null);
  assert.equal(parsePrice(null), null);
});

test('extractPrice: JSON-LD, meta, Amazon, pagine bloccate', () => {
  const ld = '<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","priceCurrency":"EUR","price":"649.00"}}</script>';
  assert.deepEqual(extractPrice(ld), { status: 'ok', price: 649 });
  const usd = '<script type="application/ld+json">{"offers":{"priceCurrency":"USD","price":"10"}}</script>';
  assert.equal(extractPrice(usd).status, 'noprice');
  assert.deepEqual(extractPrice('<meta property="og:price:amount" content="22,99">'), { status: 'ok', price: 22.99 });
  assert.deepEqual(extractPrice('<span class="a-price a-text-price"><span class="a-offscreen">13,99&nbsp;€</span>'), { status: 'ok', price: 13.99 });
  assert.equal(extractPrice('<html>Enter the characters you see below. captcha</html>').status, 'blocked');
  assert.equal(extractPrice('<html>ciao</html>').status, 'noprice');
  assert.equal(extractPrice('').status, 'empty');
});

test('safeToFetch: niente IP, localhost, nomi interni', () => {
  assert.ok(safeToFetch('https://www.amazon.it/dp/B0'));
  for (const u of ['http://127.0.0.1/x', 'http://localhost/x', 'http://192.168.1.1', 'http://[::1]/', 'ftp://x.com', 'https://router.local/', 'https://intranet/', 'nonsense']) assert.ok(!safeToFetch(u), u);
});

test('fetchPrice: legge il prezzo, segnala blocchi ed errori', async () => {
  const mk = (status, body, url = 'https://shop.example.com/p') => async () => ({ status, url, text: async () => body });
  assert.deepEqual(await fetchPrice('https://shop.example.com/p', mk(200, '<meta property="product:price:amount" content="99.90">')), { status: 'ok', price: 99.9 });
  assert.equal((await fetchPrice('https://shop.example.com/p', mk(503, 'x'))).status, 'blocked');
  assert.equal((await fetchPrice('https://shop.example.com/p', mk(404, 'x'))).status, 'gone');
  assert.equal((await fetchPrice('https://shop.example.com/p', async () => { throw new Error('rete'); })).status, 'error');
  assert.equal((await fetchPrice('http://127.0.0.1/', mk(200, ''))).status, 'invalid');
  // redirect verso un indirizzo interno
  assert.equal((await fetchPrice('https://shop.example.com/p', mk(200, '<meta property="og:price:amount" content="5">', 'http://10.0.0.1/'))).status, 'invalid');
});

// ---- rotta pricecheck: chi può chiamarla ----
process.env.APP_KEY = 'p'.repeat(40);
delete process.env.TOTP_SECRET;
delete process.env.CRON_SECRET;
const { setDbForTests } = await import('../api/_lib.js');
const pricecheck = (await import('../api/_routes/pricecheck.js')).default;
setDbForTests(async (strs) => {
  const q = strs.join('?').replace(/\s+/g, ' ').trim();
  if (q.startsWith('SELECT fails FROM auth_fails')) return [];
  return []; // nessun desiderio da controllare
});
const run = async (headers, method = 'GET') => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await pricecheck({ method, query: {}, body: {}, headers: { 'x-real-ip': '8.8.' + Math.floor(Math.random() * 250) + '.1', ...headers } }, res);
  return res;
};

test('pricecheck: ok per il cron di Vercel e per l’app, 401 per gli altri', async () => {
  assert.equal((await run({})).code, 401);
  assert.equal((await run({ 'user-agent': 'curl/8' })).code, 401);
  assert.equal((await run({ 'user-agent': 'vercel-cron/1.0' })).code, 200);
  assert.equal((await run({ 'x-app-key': process.env.APP_KEY }, 'POST')).code, 200);
  process.env.CRON_SECRET = 's'.repeat(32);
  assert.equal((await run({ 'user-agent': 'vercel-cron/1.0' })).code, 401); // con CRON_SECRET non basta più lo user-agent
  assert.equal((await run({ authorization: 'Bearer ' + process.env.CRON_SECRET })).code, 200);
  delete process.env.CRON_SECRET;
});
