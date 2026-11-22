import test from 'node:test';
import assert from 'node:assert/strict';

process.env.APP_KEY = 'a'.repeat(40);
delete process.env.INGEST_KEY;
delete process.env.TOTP_SECRET;

const { setDbForTests } = await import('../api/_lib.js');
const settings = (await import('../api/settings.js')).default;

const log = [];
setDbForTests(async (strs, ...v) => {
  const q = strs.join('?').replace(/\s+/g, ' ').trim();
  log.push([q, v]);
  if (q.startsWith('SELECT fails FROM auth_fails')) return [];
  if (q.startsWith('SELECT salary_day FROM settings')) return [{ salary_day: 9 }];
  return [];
});

const put = async (body) => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await settings({ method: 'PUT', headers: { 'x-app-key': 'a'.repeat(40), 'x-real-ip': '6.6.6.6' }, body }, res);
  return res;
};

test('sabati senza cena: si salvano solo i sabati validi, senza doppioni', async () => {
  log.length = 0;
  const r = await put({ salary: 1740, salary_day: 9, habit_weekly: 50, dinner_skips: ['2026-12-26', '2027-01-02', '2026-12-26', '2026-12-25', 'boh'] });
  assert.equal(r.code, 200);
  const ins = log.filter(([q]) => q.startsWith('INSERT INTO dinner_skips')).map(([, v]) => v[0]);
  assert.deepEqual(ins, ['2026-12-26', '2027-01-02']); // 25/12 è un venerdì, 'boh' non è una data
  assert.ok(log.some(([q]) => q.startsWith('DELETE FROM dinner_skips')), 'la lista precedente viene sostituita');
});

test('senza dinner_skips nel corpo la lista non cambia', async () => {
  log.length = 0;
  const r = await put({ salary: 1740, salary_day: 9, habit_weekly: 50 });
  assert.equal(r.code, 200);
  assert.ok(!log.some(([q]) => q.includes('dinner_skips')));
});
