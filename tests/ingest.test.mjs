import test from 'node:test';
import assert from 'node:assert/strict';

process.env.APP_KEY = 'a'.repeat(40);
process.env.INGEST_KEY = 'ingest-key-xyz';
delete process.env.TOTP_SECRET;

const { setDbForTests } = await import('../api/_lib.js');
const ingest = (await import('../api/ingest.js')).default;

const inserts = { transactions: [], inbox: [] };
let rules = [];
setDbForTests(async (strs, ...v) => {
  const q = strs.join('?').replace(/\s+/g, ' ').trim();
  if (q.includes('FROM category_rules')) return rules;
  if (q.startsWith('SELECT fails FROM auth_fails')) return [];
  if (q.startsWith('INSERT INTO transactions')) { inserts.transactions.push(v); return [{ id: inserts.transactions.length }]; }
  if (q.startsWith('INSERT INTO inbox')) { inserts.inbox.push(v); return [{ id: inserts.inbox.length }]; }
  return [];
});

const post = async (text) => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await ingest({ method: 'POST', headers: { 'x-app-key': 'ingest-key-xyz', 'x-real-ip': '5.5.5.5' }, body: { text } }, res);
  return res;
};

test('pagamento riconosciuto: registrato come spesa', async () => {
  const r = await post('Pagamento carta di 12,60 € presso PORRINI ROBERTO il 06/11');
  assert.equal(r.code, 201);
  assert.equal(inserts.transactions.length, 1);
});

test('la regola dell’utente decide la categoria', async () => {
  rules = [{ pattern: 'porrini', category: 'Salute' }];
  const r = await post('Pagamento carta di 30,00 € presso PORRINI ROBERTO il 07/11');
  assert.equal(r.body.category, 'Salute');
});

test('messaggio non riconosciuto: finisce in “Da controllare”, non va perso', async () => {
  const before = inserts.transactions.length;
  const r = await post('Novità sul tuo conto: apri l’app per i dettagli');
  assert.equal(r.code, 202);
  assert.equal(r.body.inbox, true);
  assert.equal(inserts.inbox.length, 1);
  assert.equal(inserts.transactions.length, before);
});

test('stipendio e operazioni fallite: ignorati, nemmeno in “Da controllare”', async () => {
  const n = inserts.inbox.length;
  assert.equal((await post('Accredito stipendio 1.792,26 €')).body.ignored, true);
  assert.equal((await post('Pagamento di 20,00 € non andato a buon fine')).body.ignored, true);
  assert.equal(inserts.inbox.length, n);
});

test('testo enorme rifiutato', async () => {
  assert.equal((await post('a'.repeat(30000))).code, 413);
});
