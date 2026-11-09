import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSummary } from '../api/_calc.js';
import { fixture, withTx, input, near } from './helpers.mjs';

const run = (f) => computeSummary(input(f));
const goalOf = (r, date) => r.goals.find((g) => g.date === date);
const approx = (a, b, msg, tol = 0.01) => assert.ok(near(a, b, tol), `${msg}: atteso ${b}, trovato ${a}`);

// ---- Saldo e obiettivo di dicembre, calcolati a mano ----
// base 10.395,63 + stipendi (1.792,26 + 1.740) + tredicesima 1.560 = 5.092,26 di entrate
// ricorrenti dal 5/11 al 31/12: iPhone 2×41, Sim 9,99, Nutri 2×50, Capelli 2×20, Psi 2×40, Claude 2×18, Internet 2×22,99, Scarpe 192,41 = 586,38
// cene: 50 rimaste + 200 × (1 + 22/31) = 391,94
// spendibile = 10.395,63 + 5.092,26 − 586,38 − 391,94 − 14.000 = 509,57
test('obiettivo di dicembre: spendibile calcolato a mano', () => {
  const g = goalOf(run(fixture()), '2026-12-31');
  approx(g.income, 5092.26, 'entrate');
  approx(g.recurring, 586.38, 'ricorrenti');
  approx(g.habit, 50 + 200 * (1 + 22 / 31), 'cene');
  approx(g.spendable, 509.57, 'spendibile', 0.02);
  assert.equal(g.feasible, true);
});

test('il margine di sicurezza resta fuori dal budget', () => {
  const g = goalOf(run(fixture()), '2026-12-31');
  const days = 56, lp = 4; // dal 5/11 al 31/12; fino al 9/11
  approx(g.perDay, (g.spendable - 200) / days, 'al giorno');
  approx(g.budget, g.perDay * lp, 'budget del periodo');
  const noMargin = goalOf(run(fixture({ s: { ...fixture().s, margin: 0 } })), '2026-12-31');
  approx(noMargin.budget - g.budget, (200 / days) * lp, 'effetto del margine');
});

test('con più obiettivi decide quello che stringe di più', () => {
  const r = run(fixture());
  const min = Math.min(...r.goals.map((g) => g.budget));
  approx(r.totals.budget, min, 'budget');
  assert.equal(r.goals.filter((g) => g.binding).length, 1);
  assert.equal(r.goal.id, r.goals.find((g) => g.binding).id);
});

test('saldo stimato: saldo inserito + stipendi e mensilità arrivati dopo', () => {
  assert.equal(run(fixture()).balance, 10395.63);
  // il 9/11 arriva lo stipendio di 1.792,26
  const r = run({ ...fixture(), today: '2026-11-10' });
  approx(r.balance, 10395.63 + 1792.26, 'dopo lo stipendio');
});

test('spendere riduce il rimanente 1:1', () => {
  const a = run(fixture()).totals.remaining;
  const b = run(withTx(fixture(), [{ amount: 10, category: 'Spesa' }])).totals.remaining;
  approx(a - b, 10, 'differenza');
});

test('un’entrata extra aumenta il rimanente 1:1', () => {
  const a = run(fixture()).totals.remaining;
  const b = run(withTx(fixture(), [{ type: 'income', amount: 25, category: 'Extra' }])).totals.remaining;
  approx(b - a, 25, 'differenza');
});

test('movimenti precedenti al saldo inserito non contano (sono già nel saldo)', () => {
  const a = run(fixture());
  const b = run(withTx(fixture(), [{ amount: 300, category: 'Spesa', fresh: false }]));
  approx(b.totals.remaining, a.totals.remaining, 'rimanente');
  assert.equal(b.totals.spent, 0);
});

// ---- Cene (spese abituali) ----
test('le cene consumano la quota prevista e non il rimanente libero', () => {
  const a = run(fixture());
  const b = run(withTx(fixture(), [{ amount: 30, category: 'Ristoranti' }]));
  approx(a.totals.habitLeft, 50, 'cene prima');
  approx(b.totals.habitLeft, 20, 'cene dopo');
  approx(b.totals.remaining, a.totals.remaining, 'rimanente invariato');
});

test('oltre la quota prevista le cene pesano sul rimanente', () => {
  const a = run(fixture());
  const b = run(withTx(fixture(), [{ amount: 80, category: 'Ristoranti' }]));
  approx(b.totals.habitLeft, 0, 'cene');
  approx(a.totals.remaining - b.totals.remaining, 30, 'solo gli 80−50 in più');
});

test('cene residue indicate per un periodo vecchio vengono ignorate', () => {
  const f = fixture({ s: { ...fixture().s, habit_left_for: '2026-09-09' } });
  const r = run(f);
  // 200 × (4/31 giorni che restano nel periodo) invece dei 50 indicati
  approx(r.totals.habitLeft, 200 * (4 / 31), 'quota proporzionale');
});

// ---- Ricorrenti ----
test('ricorrente in attesa: riservata; con il movimento che la conferma diventa verificata', () => {
  const pending = run(fixture());
  const claude = pending.recurring.find((r) => r.name === 'Claude');
  assert.equal(claude.status, 'pending');
  const paid = run(withTx(fixture(), [{ amount: 18, note: 'CLAUDE.AI SUBSCRIPTION' }]));
  assert.equal(paid.recurring.find((r) => r.name === 'Claude').status, 'verified');
  approx(pending.totals.reserved - paid.totals.reserved, 18, 'riservato');
  // pagare la ricorrente non deve toccare la cifra libera
  approx(paid.totals.remaining, pending.totals.remaining, 'rimanente invariato');
});

test('importo troppo diverso: non conferma la ricorrente', () => {
  const r = run(withTx(fixture(), [{ amount: 90, note: 'CLAUDE.AI' }]));
  assert.equal(r.recurring.find((x) => x.name === 'Claude').status, 'pending');
});

test('ricorrente caduta prima del saldo inserito: è già nel saldo, il prossimo addebito è nel periodo dopo', () => {
  const r = run({ ...fixture(), s: { ...fixture().s, balance_date: '2026-11-06' }, today: '2026-11-06' });
  const iphone = r.recurring.find((x) => x.name === 'iPhone');
  assert.equal(iphone.status, 'scheduled');
  assert.equal(iphone.due, '2026-12-05');
});

test('ricorrente in ritardo: segnalata solo se la data è passata', () => {
  const r = run({ ...fixture(), today: '2026-11-06' });
  assert.equal(r.recurring.find((x) => x.name === 'iPhone').overdue, true);
  assert.equal(r.recurring.find((x) => x.name === 'Nutri').overdue, false);
});

test('rata con inizio e fine: conta solo nella finestra', () => {
  const r = run(fixture());
  const scarpe = r.recurring.find((x) => x.name.startsWith('Scarpe'));
  assert.equal(scarpe.status, 'scheduled');
  // fuori dall’obiettivo di dicembre non c’è: spendibile di gennaio la include una volta sola
  const dec = goalOf(r, '2026-12-31').recurring;
  const jan = goalOf(r, '2027-01-31').recurring;
  assert.ok(jan > dec);
  approx(jan - dec, 41 + 9.99 + 50 + 20 + 40 + 18 + 22.99 + 0 /* gen: iPhone 5, Sim 4, giorno 8, Internet 17 */ + 0, 'un mese in più', 0.02);
});

// ---- Giorno variabile ----
const flexFix = () => {
  const f = fixture();
  f.recurring = f.recurring.map((r) => (['Nutri', 'Capelli', 'Psi'].includes(r.name) ? { ...r, flex: true } : r));
  return f;
};

test('giorno variabile: mai in ritardo, riservata, nessuna data fissa', () => {
  const r = run({ ...flexFix(), today: '2026-11-08' });
  for (const n of ['Nutri', 'Capelli', 'Psi']) {
    const x = r.recurring.find((y) => y.name === n);
    assert.equal(x.flex, true);
    assert.equal(x.status, 'pending');
    assert.equal(x.overdue, false);
  }
  approx(r.totals.reserved, 41 + 50 + 20 + 40 + 18, 'riservato (iPhone, Nutri, Capelli, Psi, Claude)');
});

test('giorno variabile: una volta per periodo, l’ultimo in proporzione ai giorni', () => {
  const day = goalOf(run(fixture()), '2026-12-31').recurring;
  const flex = goalOf(run(flexFix()), '2026-12-31').recurring;
  // Nutri+Capelli+Psi = 110: periodo corrente 1 + periodo 9/11–9/12 1 + 9/12–31/12 per 22/31
  approx(flex - (day - 2 * 110), 110 * (2 + 22 / 31), 'ricorrenti variabili');
});

test('giorno variabile: si conferma con il movimento e smette di pesare', () => {
  const r = run(withTx(flexFix(), [{ amount: 50, note: 'Nutri Rossi' }]));
  assert.equal(r.recurring.find((x) => x.name === 'Nutri').status, 'verified');
});

// ---- Entrate ----
test('stipendio diverso dallo standard: la differenza va nello spendibile', () => {
  const std = run(fixture({ overrides: [] }));
  const ovr = run(fixture());
  approx(goalOf(ovr, '2026-12-31').spendable - goalOf(std, '2026-12-31').spendable, 52.26, 'differenza');
});

test('la tredicesima conta solo negli obiettivi dopo il 24 dicembre', () => {
  const r = run(fixture());
  assert.equal(goalOf(r, '2026-12-31').bonus, 1560);
  const nov = run({ ...fixture(), goalRows: [{ id: 1, amount: 11000, date: '2026-12-10' }] });
  assert.equal(nov.goals[0].bonus, 0);
});

test('la quattordicesima di giugno entra nell’ultimo obiettivo', () => {
  const g = goalOf(run(fixture()), '2027-06-30');
  assert.equal(g.bonus, 1560 + 1560); // tredicesima dicembre + quattordicesima giugno
});

// ---- Modalità senza obiettivo e casi limite ----
test('senza obiettivi: budget = stipendio + extra − risparmio; rimanente = budget − spese − riservato', () => {
  const f = fixture({ goalRows: [], overrides: [], s: { ...fixture().s, savings_goal: 300, balance_ref: null, balance_date: null } });
  const r = run(withTx(f, [{ amount: 100, category: 'Spesa' }]));
  assert.equal(r.goal, null);
  approx(r.totals.budget, 1740 - 300, 'budget');
  approx(r.totals.remaining, 1740 - 300 - 100 - r.totals.reserved, 'rimanente');
});

test('obiettivo già scaduto: marcato come tale e si torna alla modalità semplice', () => {
  const r = run({ ...fixture(), today: '2027-07-01', goalRows: [{ id: 1, amount: 1000, date: '2027-06-30' }], s: { ...fixture().s, balance_date: '2027-06-01' } });
  assert.equal(r.goal.expired, true);
  assert.equal(r.goals[0].expired, true);
});

test('obiettivo irraggiungibile: non fattibile', () => {
  const r = run(fixture({ goalRows: [{ id: 1, amount: 50000, date: '2026-12-31' }] }));
  assert.equal(r.goals[0].feasible, false);
  assert.ok(r.goals[0].spendable < 0);
});

test('saldo inserito in un periodo precedente: la finestra parte dall’inizio del periodo', () => {
  const f = fixture({ today: '2026-11-20', s: { ...fixture().s, balance_date: '2026-10-20', habit_left_for: null, habit_left: null } });
  const r = run(f);
  assert.equal(r.period.start, '2026-11-09');
  // nessun “entry”: le cene sono la quota intera del mese
  approx(r.totals.habitLeft, 200, 'cene');
});

test('giorno di stipendio: il nuovo periodo comincia e i totali ripartono', () => {
  const r = run({ ...fixture(), today: '2026-11-09', s: { ...fixture().s, habit_left_for: null, habit_left: null } });
  assert.equal(r.period.start, '2026-11-09');
  assert.equal(r.totals.spent, 0);
});

test('risposta completa: campi usati dall’app', () => {
  const r = run(fixture());
  for (const k of ['today', 'settings', 'period', 'totals', 'balance', 'goal', 'goals', 'salaries', 'nextPayday', 'recurring', 'bonuses', 'categories', 'transactions']) assert.ok(k in r, k);
  assert.equal(r.nextPayday, '2026-11-09');
});

// ---- Percorso nel tempo e mesi chiusi ----
import { closedPeriods, monthlyTarget } from '../api/_calc.js';
import { period } from '../api/_lib.js';

test('percorso previsto: parte dal saldo di oggi e a ogni scadenza coincide con obiettivo + spendibile', () => {
  const r = run(fixture());
  assert.equal(r.projection[0].date, '2026-11-05');
  assert.equal(r.projection[0].balance, 10395.63);
  for (const g of r.goals) {
    const pt = r.projection.find((x) => x.date === g.date);
    assert.ok(pt, `manca il punto del ${g.date}`);
    approx(pt.balance, g.amount + g.spendable, `saldo previsto al ${g.date}`);
  }
  const dates = r.projection.map((x) => x.date);
  assert.deepEqual(dates, [...dates].sort(), 'punti in ordine di data');
  assert.ok(dates.includes('2026-12-24'), 'la tredicesima è un punto del percorso');
});

test('senza obiettivi non c’è percorso', () => {
  assert.deepEqual(run(fixture({ goalRows: [] })).projection, []);
});

test('obiettivo mensile dedotto dalle scadenze: 1.000 € al mese', () => {
  assert.equal(run(fixture()).monthlyTarget, 1000);
  assert.equal(monthlyTarget([{ amount: 5000 }]), null);
});

test('mesi chiusi: variazione del saldo tra le fine di due periodi, solo con fotografie vicine', () => {
  const p = period('2027-02-15', 9); // periodo 9/2 → 9/3
  const history = [
    { date: '2026-12-08', balance: 11000 }, // fine periodo dicembre
    { date: '2027-01-08', balance: 12100 }, // fine periodo gennaio
    { date: '2027-02-08', balance: 13050 }, // fine periodo febbraio
  ];
  const c = closedPeriods(history, p, 9);
  assert.equal(c.length, 2);
  assert.equal(c[0].end, '2027-02-09');
  approx(c[0].change, 950, 'variazione di gennaio→febbraio');
  approx(c[1].change, 1100, 'variazione di dicembre→gennaio');
  assert.deepEqual(closedPeriods([], p, 9), []);
});

test('movimento rimborsato da altri: il saldo scende ma budget, spese e categorie non cambiano', () => {
  const base = computeSummary(input(withTx(fixture({ today: '2026-11-10' }), [{ amount: 20, category: 'Spesa' }])));
  const f = withTx(fixture({ today: '2026-11-10' }), [{ amount: 20, category: 'Spesa' }, { amount: 98, category: 'Altro', note: 'Airbnb' }]);
  f.transactions = f.transactions.map((x) => (x.note === 'Airbnb' ? { ...x, refund: true } : x));
  const inp = input(f);
  const r = computeSummary(inp);
  assert.ok(near(r.balance, base.balance - 98), 'saldo include la spesa');
  assert.ok(near(r.totals.spent, base.totals.spent));
  assert.ok(near(r.totals.remaining, base.totals.remaining));
  assert.ok(near(r.totals.budget, base.totals.budget));
  assert.deepEqual(r.categories, base.categories);
  assert.equal(r.transactions.length, 2); // resta visibile nell'elenco
});
