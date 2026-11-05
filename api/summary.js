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
           balance_ref::float8 AS balance_ref,
           to_char(balance_set_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS balance_date,
           goal_amount::float8 AS goal_amount, to_char(goal_date, 'YYYY-MM-DD') AS goal_date
    FROM settings WHERE id = 1`;

  const today = todayStr();
  const p = period(today, s.salary_day);

  const [transactions, recurring, bonuses, delta] = await Promise.all([
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
  ]);

  // ---- Saldo stimato: saldo inserito + movimenti + stipendi e mensilità arrivati da allora ----
  let balance = null;
  if (s.balance_ref !== null && s.balance_date) {
    const bonusIn = sum(bonuses, (b) => b.amount * yearlyDates(b.month, b.day, s.balance_date, today).length);
    balance = s.balance_ref + delta[0].d + countSalaryDates(s.balance_date, today, s.salary_day) * s.salary + bonusIn;
  }

  // ---- Modalità: con obiettivo (serve saldo + data futura) oppure semplice ----
  const hasGoal = s.goal_amount !== null && s.goal_date && balance !== null;
  const goalMode = hasGoal && s.goal_date > today;
  // Se il saldo è stato inserito in questo periodo, si parte da quel momento (le spese prima sono già nel saldo).
  const entry = goalMode && s.balance_date >= p.start;
  const s0 = entry ? s.balance_date : p.start;
  const afterB = entry ? s0 : addDaysStr(s0, -1); // le mensilità del giorno s0 contano solo nei periodi "normali"

  const win = transactions.filter((x) => !entry || x.fresh);
  const spent = sum(win.filter((x) => x.type === 'expense'), (x) => x.amount);
  const extra = sum(win.filter((x) => x.type === 'income'), (x) => x.amount);
  const spentToday = sum(win.filter((x) => x.type === 'expense' && x.date === today), (x) => x.amount);
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

  if (goalMode) {
    const D = s.goal_date;
    const paydays = countSalaryDates(s0, D, s.salary_day);
    const futBonus = sum(bonuses, (b) => b.amount * yearlyDates(b.month, b.day, afterB, D).length);
    const futureIncome = s.salary * paydays + futBonus;
    const recurringTotal = sum(recurring, (r) => {
      const from = r.starts && r.starts > s0 ? r.starts : s0;
      const to = r.until && r.until < D ? r.until : D;
      return from > to ? 0 : r.amount * monthlyCount(r.day, from, to);
    });
    // Saldo a inizio finestra: non cambia se spendi o incassi dopo (così spendere riduce il budget 1:1)
    base = balance + spent - extra - arrivedBonus;
    const A = base + futureIncome - recurringTotal - s.goal_amount; // quanto puoi spendere in tutto fino alla data
    const n = Math.max(1, diffDays(s0, D));
    const L = Math.min(Math.max(1, diffDays(s0, p.end)), n);
    const perDay = A / n;
    budget = perDay * L; // budget "libero" del periodo, già al netto delle ricorrenti
    const paidRec = sum(matched.filter((m) => m.inWin), (m) => m.amount);
    spentBar = spent - paidRec;
    remaining = budget + extra - spentBar;
    savings = 0;
    goal = {
      amount: s.goal_amount, date: D, balance, expired: false,
      feasible: A >= 0, spendable: A, perDay, income: futureIncome, bonus: futBonus,
      paydays, days: n, need: s.goal_amount - base, recurring: recurringTotal,
    };
  } else {
    if (hasGoal) goal = { amount: s.goal_amount, date: s.goal_date, balance, expired: true };
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
    settings: { salary: s.salary, salary_day: s.salary_day, goal_amount: s.goal_amount, goal_date: s.goal_date },
    period: p,
    totals: {
      income: s.salary + extra + arrivedBonus,
      extra,
      bonus: arrivedBonus,
      spent,
      spentToday,
      spentBar,
      savings,
      toGoal: goalMode ? Math.max(0, s.goal_amount - balance) : 0,
      reserved,
      budget,
      remaining,
      perDay: perDayNow,
      todayLeft,
    },
    balance,
    goal,
    recurring: rec,
    bonuses: bon,
    categories,
    transactions,
  });
});
