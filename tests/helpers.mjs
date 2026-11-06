// Dati di prova: ricalcano la situazione reale di novembre 2026 (stipendio il 9, saldo 10.395,63 € inserito il 5/11).
export const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

export function fixture(over = {}) {
  const f = {
    s: {
      salary: 1740, salary_day: 9, savings_goal: 0, habit: 200, habit_left: 50, habit_left_for: '2026-10-09',
      margin: 200, balance_ref: 10395.63, balance_date: '2026-11-05',
    },
    today: '2026-11-05',
    transactions: [],
    recurring: [
      { id: 4, name: 'Scarpe (ultima rata)', amount: 192.41, day: 1, match: '', flex: false, starts: '2026-12-01', until: '2026-12-01' },
      { id: 2, name: 'Sim', amount: 9.99, day: 4, match: '', flex: false, starts: null, until: null },
      { id: 3, name: 'iPhone', amount: 41, day: 5, match: '', flex: false, starts: null, until: null },
      { id: 1, name: 'Nutri', amount: 50, day: 8, match: '', flex: false, starts: null, until: null },
      { id: 5, name: 'Capelli', amount: 20, day: 8, match: '', flex: false, starts: null, until: null },
      { id: 7, name: 'Psi', amount: 40, day: 8, match: '', flex: false, starts: null, until: null },
      { id: 8, name: 'Claude', amount: 18, day: 8, match: 'claude', flex: false, starts: null, until: null },
      { id: 6, name: 'Internet', amount: 22.99, day: 17, match: '', flex: false, starts: null, until: null },
    ],
    bonuses: [
      { id: 1, name: 'Tredicesima', month: 12, day: 24, amount: 1560 },
      { id: 2, name: 'Quattordicesima', month: 6, day: 23, amount: 1560 },
    ],
    goalRows: [
      { id: 3, amount: 14000, date: '2026-12-31' },
      { id: 4, amount: 15000, date: '2027-01-31' },
      { id: 5, amount: 16000, date: '2027-02-28' },
      { id: 6, amount: 17000, date: '2027-03-31' },
      { id: 7, amount: 18000, date: '2027-04-30' },
      { id: 8, amount: 19000, date: '2027-05-31' },
      { id: 9, amount: 20000, date: '2027-06-30' },
    ],
    overrides: [{ date: '2026-11-09', amount: 1792.26 }],
    ...over,
  };
  return f;
}

// Aggiunge un movimento (dopo l'inserimento del saldo, quindi "fresh") e tiene coerente la somma.
export function withTx(f, list) {
  const transactions = list.map((x, i) => ({ id: 100 + i, type: 'expense', category: 'Altro', note: '', date: f.today, fresh: true, ...x }));
  return { ...f, transactions: [...f.transactions, ...transactions] };
}

// Come fa il server: delta = somma dei movimenti registrati dopo il saldo.
export function input(f) {
  const d = f.transactions.filter((x) => x.fresh).reduce((a, x) => a + (x.type === 'income' ? x.amount : -x.amount), 0);
  return { ...f, delta: [{ d }] };
}
