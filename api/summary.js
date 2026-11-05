import { handler, db, todayStr, period, countSalaryDates, dueInPeriod } from './_lib.js';

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

  const [totals, categories, transactions, recurring, delta] = await Promise.all([
    sql`SELECT
          COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0)::float8 AS spent,
          COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0)::float8 AS extra,
          COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND date = ${today}::date), 0)::float8 AS spent_today
        FROM transactions
        WHERE date >= ${p.start}::date AND date < ${p.end}::date`,
    sql`SELECT category, SUM(amount)::float8 AS total
        FROM transactions
        WHERE type = 'expense' AND date >= ${p.start}::date AND date < ${p.end}::date
        GROUP BY category ORDER BY total DESC`,
    sql`SELECT id, type, amount::float8 AS amount, category, note,
               to_char(date, 'YYYY-MM-DD') AS date
        FROM transactions
        WHERE date >= ${p.start}::date AND date < ${p.end}::date
        ORDER BY date DESC, id DESC LIMIT 300`,
    sql`SELECT id, name, amount::float8 AS amount, day, match FROM recurring ORDER BY day, id`,
    // Movimenti registrati dopo l'ultima volta in cui hai inserito il saldo
    sql`SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0)::float8 AS d
        FROM transactions
        WHERE created_at > (SELECT balance_set_at FROM settings WHERE id = 1)`,
  ]);

  const { spent, extra, spent_today: spentToday } = totals[0];

  // ---- Spese ricorrenti: "verificata" se un SMS/movimento la conferma, altrimenti riservata ----
  const used = new Set();
  const rec = recurring.map((r) => {
    const key = (r.match || r.name).toLowerCase();
    const tol = Math.max(5, r.amount * 0.3);
    let best = null;
    for (const x of transactions) {
      if (x.type !== 'expense' || used.has(x.id)) continue;
      if (!`${x.note} ${x.category}`.toLowerCase().includes(key)) continue;
      const diff = Math.abs(x.amount - r.amount);
      if (diff <= tol && (!best || diff < best.diff)) best = { x, diff };
    }
    if (best) used.add(best.x.id);
    const due = dueInPeriod(r.day, p.start, p.end);
    return {
      id: r.id,
      name: r.name,
      amount: r.amount,
      day: r.day,
      match: r.match,
      due,
      status: best ? 'verified' : 'pending',
      overdue: !best && due < today,
      paid: best ? { amount: best.x.amount, date: best.x.date } : null,
    };
  });
  const reserved = rec.filter((r) => r.status === 'pending').reduce((a, r) => a + r.amount, 0);

  // ---- Saldo stimato e obiettivo ----
  let balance = null;
  if (s.balance_ref !== null && s.balance_date) {
    balance = s.balance_ref + delta[0].d + countSalaryDates(s.balance_date, today, s.salary_day) * s.salary;
  }

  let saving = s.savings_goal;
  let goal = null;
  if (s.goal_amount !== null && s.goal_date && balance !== null) {
    // Saldo a inizio periodo (stipendio già accreditato, nessuna spesa ancora fatta):
    // non cambia se spendi o incassi durante il mese, così spendere non gonfia il risparmio richiesto.
    const start = balance + spent - extra;
    // Quanti stipendi arrivano da qui alla data obiettivo: a ognuno il saldo di inizio periodo sale del risparmio mensile.
    const paydays = countSalaryDates(p.start, s.goal_date, s.salary_day);
    saving =
      paydays >= 1
        ? Math.max(0, s.goal_amount - start) / paydays
        : Math.max(0, s.salary + s.goal_amount - start); // la data cade prima del prossimo stipendio
    goal = {
      amount: s.goal_amount,
      date: s.goal_date,
      balance,
      gap: Math.max(0, s.goal_amount - start),
      perMonth: saving,
      months: paydays,
      reached: saving < 0.005,
      expired: s.goal_date <= today,
    };
  }

  const budget = s.salary + extra - saving;
  const remaining = budget - spent - reserved;
  const days = Math.max(p.daysLeft, 1);
  const perDay = Math.max(0, (remaining + spentToday) / days);
  const todayLeft = (remaining + spentToday) / days - spentToday;

  res.status(200).json({
    today,
    settings: {
      salary: s.salary,
      salary_day: s.salary_day,
      goal_amount: s.goal_amount,
      goal_date: s.goal_date,
    },
    period: p,
    totals: {
      income: s.salary + extra,
      extra,
      spent,
      spentToday,
      savings: saving,
      reserved,
      budget,
      remaining,
      perDay,
      todayLeft,
    },
    balance,
    goal,
    recurring: rec,
    categories,
    transactions,
  });
});
