import test from 'node:test';
import assert from 'node:assert/strict';
import { period, salaryDates, monthlyCount, yearlyDates, nextOccurrence, dueInPeriod, diffDays } from '../api/_lib.js';

test('periodo: prima e dopo lo stipendio', () => {
  assert.deepEqual(period('2026-11-05', 9), { start: '2026-10-09', end: '2026-11-09', daysLeft: 4, totalDays: 31 });
  assert.equal(period('2026-11-09', 9).start, '2026-11-09'); // il giorno di stipendio apre il nuovo periodo
  assert.equal(period('2026-11-08', 9).end, '2026-11-09');
});

test('periodo: stipendio il 31 in un mese corto', () => {
  const p = period('2027-02-20', 31);
  assert.equal(p.start, '2027-01-31');
  assert.equal(p.end, '2027-02-28');
});

test('date di stipendio nell’intervallo (after, upto]', () => {
  assert.deepEqual(salaryDates('2026-11-05', '2026-12-31', 9), ['2026-11-09', '2026-12-09']);
  assert.deepEqual(salaryDates('2026-11-09', '2026-12-09', 9), ['2026-12-09']); // after escluso, upto incluso
});

test('ricorrenza mensile: conteggio tra due date, estremi inclusi', () => {
  assert.equal(monthlyCount(5, '2026-11-05', '2026-12-31'), 2);
  assert.equal(monthlyCount(4, '2026-11-05', '2026-12-31'), 1);
  assert.equal(monthlyCount(31, '2027-01-01', '2027-03-01'), 2); // gen 31, feb 28
});

test('pagamento annuale (tredicesima)', () => {
  assert.deepEqual(yearlyDates(12, 24, '2026-11-05', '2026-12-31'), ['2026-12-24']);
  assert.deepEqual(yearlyDates(12, 24, '2026-12-24', '2027-12-31'), ['2027-12-24']); // after escluso
});

test('prossima occorrenza e scadenza nel periodo', () => {
  assert.equal(nextOccurrence(4, '2026-11-05'), '2026-12-04');
  assert.equal(nextOccurrence(5, '2026-11-05'), '2026-11-05');
  assert.equal(dueInPeriod(17, '2026-11-09', '2026-12-09'), '2026-11-17');
  assert.equal(dueInPeriod(4, '2026-11-09', '2026-12-09'), '2026-12-04');
  assert.equal(diffDays('2026-11-05', '2026-12-31'), 56);
});
