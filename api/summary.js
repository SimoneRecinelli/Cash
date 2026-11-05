import {
  handler, db, todayStr, period, diffDays, countSalaryDates, dueInPeriod,
  yearlyDates, monthlyCount, addDaysStr, nextOccurrence,
} from './_lib.js';

const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

export default handler(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo non consentito' });
  const sql = db();

  const [s] = await sql`
    SELECT salary::float8 AS salary, salary_day, savings_goal::float8 AS savings_goal,
           habit_monthly::float8 AS habit,
           balance_ref::float8 AS balance_ref,
           to_char(balance_set_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS balance_date
    FROM settings WHERE id = 1`;

  const today = todayStr();
  const p = period(today, s.salary_day);

  const [transactions, recurring, bonuses, delta, goalRows] = await Promise.all([
    sql`SELECT id, type, amount::float8 AS amount, category, note,
               to_char(date, 'YYYY-MM-DD') AS date,
               (created_at > (SELECT balance_set_at FROM settings WHERE id = 1)) AS fresh
        FROM transactions
        WHERE date >= ${p.start}::date AND date < ${p.end}::date
        ORDER BY date DESC, id DESC LIMIT 1000`,
    sql`SELECT id, name, amount::float8 AS amount, day, match,
               to_char(starts, 'YYYY-MM-DD') AS starts, to_char(until, 'YYYY-MM-DD') AS until
        FROM recurring ORDER BY day, id`,
    sql`SELECT id, name, month, day, amount::float8 AS amount FROM bonuses ORDER BY month, day, id`,
    // Movimenti registrati dopo l'ultima volta in cui hai inserito il saldo
    sql`SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0)::float8 AS d
        FROM transactions
        WHERE created_at > (SELECT balance_set_at FROM settings WHERE id = 1)`,
    sql`SELECT id, amount::float8 AS amount, to_char(date, 'YYYY-MM-DD') AS date FROM goals ORDER BY date, id`,
  ]);

  // ---- Saldo stimato: saldo inserito + movimenti + stipendi e mensilità arrivati da allora ----
  let balance = null;
  if (s.balance_ref !== null && s.balance_date) {
    const bonusIn = sum(bonuses, (b) => b.amount * yearlyDates(b.month, b.day, s.balance_date, today).length);
    balance = s.balance_ref + delta[0].d + countSalaryDates(s.balance_date, today, s.salary_day) * s.salary + bonusIn;
  }

  // ---- Modalità: con obiettivo (serve saldo + data futura) oppure semplice ----
  const hasGoal = goalRows.length > 0 && balance !== null;
  const active = hasGoal ? goalRows.filter((g) => g.date > today) : [];
  const goalMode = active.length > 0;
  // Se il saldo è stato inserito in questo periodo, si parte da quel momento (le spese prima sono già nel saldo).
  const entry = goalMode && s.balance_date >= p.start;
  const s0 = entry ? s.balance_date : p.start;
  const afterB = entry ? s0 : addDaysStr(s0, -1); // le mensilità del giorno s0 contano solo nei periodi "normali"

  const win = transactions.filter((x) => !entry || x.fresh);
  const spent = sum(win.filter((x) => x.type === 'expense'), (x) => x.amount);
  const extra = sum(win.filter((x) => x.type === 'income'), (x) => x.amount);
  const spentToday = sum(win.filter((x) => x.type === 'expense' && x.date === today), (x) => x.amount);
  // Spese abituali (es. cene): quota mensile attesa; le spese in "Ristoranti" la consumano
  const habit = s.habit || 0;
  const habitSpent = Math.min(habit, sum(win.filter((x) => x.type === 'expense' && x.category === 'Ristoranti'), (x) => x.amount));
  const habitMonths = (from, D) => {
    // mesi (frazionari) di periodo di stipendio compresi tra from e D
    const first = period(from, s.salary_day);
    let m = diffDays(from, D < first.end ? D : first.end) / diffDays(first.start, first.end);
    let ps = first.end;
    while (ps < D) {
      const q = period(ps, s.salary_day);
      m += diffDays(ps, D < q.end ? D : q.end) / diffDays(q.start, q.end);
      ps = q.end;
    }
    return Math.max(0, m);
  };
  const arrivedBonus = sum(bonuses, (b) => b.amount * yearlyDates(b.month, b.day, afterB, today).length);

  // ---- Spese ricorrenti: "verificata" se un SMS/movimento la conferma, altrimenti riservata ----
  const used = new Set();
  const matched = [];
  const rec = [];
  for (const r of recurring) {
    if (r.until && r.until < p.start) continue; // conclusa
    const item = { id: r.id, name: r.name, amount: r.amount, day: r.day, match: r.match, starts: r.starts, until: r.until };
    const dueNow = dueInPeriod(r.day, p.start, p.end);
    if ((r.starts && dueNow < r.starts) || (r.until && dueNow > r.until)) {
      // Non cade in questo periodo: se deve ancora iniziare la mostro come programmata
      if (r.starts && r.starts > p.start) {
        rec.push({ ...item, due: nextOccurrence(r.day, r.starts), status: 'scheduled', overdue: false, paid: null });
      }
      continue;
    }
    // Addebito di questo periodo caduto prima del saldo inserito: è già nel saldo, il prossimo è quello del periodo dopo
    if (entry && dueNow < s0) {
      rec.push({ ...item, due: nextOccurrence(r.day, s0), status: 'scheduled', overdue: false, paid: null });
      continue;
    }
    const key = (r.match || r.name).toLowerCase();
    const tol = Math.max(5, r.amount * 0.3);
    let best = null;
    for (const x of transactions) {
      if (x.type !== 'expense' || used.has(x.id)) continue;
      if (!`${x.note} ${x.category}`.toLowerCase().includes(key)) continue;
      const diff = Math.abs(x.amount - r.amount);
      if (diff <= tol && (!best || diff < best.diff)) best = { x, diff };
    }
    if (best) {
      used.add(best.x.id);
      matched.push({ amount: best.x.amount, date: best.x.date, inWin: !entry || best.x.fresh });
    }
    rec.push({
      ...item,
      due: dueNow,
      status: best ? 'verified' : 'pending',
      overdue: !best && dueNow < today,
      paid: best ? { amount: best.x.amount, date: best.x.date } : null,
    });
  }
  const reserved = sum(rec.filter((r) => r.status === 'pending' && (!goalMode || r.due >= s0)), (r) => r.amount);

  // ---- Calcolo del budget del periodo ----
  let remaining, budget, spentBar, goal = null, base = null;
  let savings = s.savings_goal;

  let goals = [];
  if (goalMode) {
    // Saldo a inizio finestra: non cambia se spendi o incassi dopo (così spendere riduce il budget 1:1)
    base = balance + spent - extra - arrivedBonus;
    const paidRec = sum(matched.filter((m) => m.inWin), (m) => m.amount);
    spentBar = spent - paidRec - habitSpent;
    const lp = Math.max(1, diffDays(s0, p.end));
    goals = active.map((g) => {
      const D = g.date;
      const paydays = countSalaryDates(s0, D, s.salary_day);
      const futBonus = sum(bonuses, (b) => b.amount * yearlyDates(b.month, b.day, afterB, D).length);
      const futureIncome = s.salary * paydays + futBonus;
      const recurringTotal = sum(recurring, (r) => {
        const from = r.starts && r.starts > s0 ? r.starts : s0;
        const to = r.until && r.until < D ? r.until : D;
        return from > to ? 0 : r.amount * monthlyCount(r.day, from, to);
      });
      const habitTotal = habit * habitMonths(s0, D);
      const A = base + futureIncome - recurringTotal - habitTotal - g.amount; // quanto puoi spendere in tutto fino alla data
      const n = Math.max(1, diffDays(s0, D));
      const L = Math.min(lp, n);
      const perDay = A / n;
      return {
        id: g.id, amount: g.amount, date: D, balance, expired: false,
        feasible: A >= 0, spendable: A, perDay, income: futureIncome, bonus: futBonus,
        paydays, days: n, need: g.amount - base, recurring: recurringTotal, habit: habitTotal, budget: perDay * L,
      };
    });
    // L'obiettivo che stringe di più decide il budget del periodo
    const bind = goals.reduce((m, g) => (g.budget < m.budget ? g : m), goals[0]);
    bind.binding = true;
    goal = bind;
    budget = bind.budget;
    remaining = budget + extra - spentBar;
    savings = 0;
  } else {
    if (hasGoal) {
      const last = goalRows[goalRows.length - 1];
      goal = { id: last.id, amount: last.amount, date: last.date, balance, expired: true };
      goals = goalRows.map((g) => ({ id: g.id, amount: g.amount, date: g.date, balance, expired: true }));
    }
    budget = s.salary + extra + arrivedBonus - savings;
    spentBar = spent;
    remaining = budget - spent - reserved;
  }

  const dl = Math.max(p.daysLeft, 1);
  const paidRecToday = goalMode ? sum(matched.filter((m) => m.inWin && m.date === today), (m) => m.amount) : 0;
  const spentTodayFree = spentToday - paidRecToday;
  const perDayNow = Math.max(0, (remaining + spentTodayFree) / dl);
  const todayLeft = (remaining + spentTodayFree) / dl - spentTodayFree;

  // ---- Mensilità aggiuntive: arrivata in questo periodo oppure prossima data ----
  const bon = bonuses.map((b) => {
    const arrived = yearlyDates(b.month, b.day, addDaysStr(p.start, -1), today)[0];
    const next = yearlyDates(b.month, b.day, today, addDaysStr(today, 400))[0];
    return {
      id: b.id, name: b.name, month: b.month, day: b.day, amount: b.amount,
      date: arrived || next, status: arrived ? 'arrived' : 'upcoming',
    };
  });

  const catMap = new Map();
  for (const x of transactions) {
    if (x.type === 'expense') catMap.set(x.category, (catMap.get(x.category) || 0) + x.amount);
  }
  const categories = [...catMap].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);

  res.status(200).json({
    today,
    settings: { salary: s.salary, salary_day: s.salary_day, habit: s.habit },
    period: p,
    totals: {
      income: s.salary + extra + arrivedBonus,
      extra,
      bonus: arrivedBonus,
      spent,
      spentToday,
      spentBar,
      savings,
      toGoal: goalMode ? Math.max(0, goal.amount - balance) : 0,
      reserved,
      budget,
      remaining,
      perDay: perDayNow,
      todayLeft,
    },
    balance,
    goal,
    goals,
    recurring: rec,
    bonuses: bon,
    categories,
    transactions,
  });
});
