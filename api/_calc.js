import {
  period, diffDays, salaryDates, dueInPeriod,
  yearlyDates, monthlyCount, addDaysStr, nextOccurrence,
} from './_lib.js';

const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

// Calcolo puro del riepilogo: nessun accesso a database né all'orologio (today è un parametro).
export function computeSummary({ s, today, transactions, recurring, bonuses, delta, goalRows, overrides, history = [] }) {
  const p = period(today, s.salary_day);

  // Stipendio di una data: quello indicato per quel mese, altrimenti lo standard
  const ovr = new Map(overrides.map((o) => [o.date, o.amount]));
  const salaryOf = (d) => (ovr.has(d) ? ovr.get(d) : s.salary);
  const salarySum = (after, upto) => sum(salaryDates(after, upto, s.salary_day), salaryOf);

  // ---- Saldo stimato: saldo inserito + movimenti + stipendi e mensilità arrivati da allora ----
  let balance = null;
  if (s.balance_ref !== null && s.balance_date) {
    const bonusIn = sum(bonuses, (b) => b.amount * yearlyDates(b.month, b.day, s.balance_date, today).length);
    balance = s.balance_ref + delta[0].d + salarySum(s.balance_date, today) + bonusIn;
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
  // Quota di spese abituali del periodo corrente: indicata da te (cene ancora previste) oppure,
  // se il saldo è stato inserito a metà periodo, la parte proporzionale ai giorni che restano.
  const frac = entry ? diffDays(s0, p.end) / diffDays(p.start, p.end) : 1;
  const leftSet = s.habit_left !== null && s.habit_left_for === p.start;
  const curHabit = leftSet ? s.habit_left : habit * frac;
  const habitSpent = Math.min(curHabit, sum(win.filter((x) => x.type === 'expense' && x.category === 'Ristoranti'), (x) => x.amount));
  const habitLeft = Math.max(0, curHabit - habitSpent);
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
    const flex = !!r.flex;
    const item = { id: r.id, name: r.name, amount: r.amount, day: r.day, match: r.match, starts: r.starts, until: r.until, flex, installment: !!r.installment };
    // A giorno variabile: nessuna data prevista, vale per tutto il periodo (ai fini delle date: ultimo giorno)
    const dueNow = flex ? addDaysStr(p.end, -1) : dueInPeriod(r.day, p.start, p.end);
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
      overdue: !flex && !best && dueNow < today,
      paid: best ? { amount: best.x.amount, date: best.x.date } : null,
    });
  }
  const reserved = sum(rec.filter((r) => r.status === 'pending' && (!goalMode || r.due >= s0)), (r) => r.amount);

  // ---- Calcolo del budget del periodo ----
  let remaining, budget, spentBar, goal = null, base = null, projection = [];
  let savings = s.savings_goal;

  let goals = [];
  if (goalMode) {
    // Saldo a inizio finestra: non cambia se spendi o incassi dopo (così spendere riduce il budget 1:1)
    base = balance + spent - extra - arrivedBonus;
    const paidRec = sum(matched.filter((m) => m.inWin), (m) => m.amount);
    spentBar = spent - paidRec - habitSpent;
    const lp = Math.max(1, diffDays(s0, p.end));
    // Cosa entra e cosa esce tra l'inizio finestra e la data D → saldo previsto a D (senza spese libere)
    const proj = (D) => {
      const futBonus = sum(bonuses, (b) => b.amount * yearlyDates(b.month, b.day, afterB, D).length);
      const futureIncome = salarySum(s0, D) + futBonus;
      const recurringTotal = sum(recurring, (r) => {
        const from = r.starts && r.starts > s0 ? r.starts : s0;
        const to = r.until && r.until < D ? r.until : D;
        if (from > to) return 0;
        if (!r.flex) return r.amount * monthlyCount(r.day, from, to);
        // Giorno variabile: una volta per periodo di stipendio. Il periodo di partenza conta intero
        // (è ancora in attesa); l'ultimo, se la scadenza cade a metà, conta in proporzione ai giorni.
        let n = 0;
        for (let q = period(from, s.salary_day); q.start <= to; q = period(q.end, s.salary_day)) {
          n += q.start <= from ? 1 : Math.min(1, diffDays(q.start, to) / diffDays(q.start, q.end));
        }
        return r.amount * n;
      });
      const habitTotal = D <= p.end ? curHabit * (diffDays(s0, D) / Math.max(1, diffDays(s0, p.end))) : curHabit + habit * habitMonths(p.end, D);
      return { futBonus, futureIncome, recurringTotal, habitTotal, end: base + futureIncome - recurringTotal - habitTotal };
    };
    goals = active.map((g) => {
      const D = g.date;
      const paydays = salaryDates(s0, D, s.salary_day).length;
      const { futBonus, futureIncome, recurringTotal, habitTotal, end } = proj(D);
      const A = end - g.amount; // quanto puoi spendere in tutto fino alla data
      const n = Math.max(1, diffDays(s0, D));
      const L = Math.min(lp, n);
      const perDay = (A - (s.margin || 0)) / n; // il margine di sicurezza resta fuori dal budget
      return {
        id: g.id, amount: g.amount, date: D, balance, expired: false,
        feasible: A >= 0, spendable: A, perDay, income: futureIncome, bonus: futBonus,
        paydays, days: n, need: g.amount - base, recurring: recurringTotal, habit: habitTotal, budget: perDay * L, margin: s.margin || 0,
      };
    });
    // Percorso del saldo previsto: a ogni stipendio, mensilità e scadenza di un obiettivo
    const last = active[active.length - 1].date;
    const dates = new Set([...salaryDates(s0, last, s.salary_day), ...active.map((g) => g.date)]);
    for (const b of bonuses) for (const d of yearlyDates(b.month, b.day, afterB, last)) dates.add(d);
    projection = [{ date: today, balance }, ...[...dates].sort().filter((d) => d > today).map((d) => ({ date: d, balance: proj(d).end }))];
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
    budget = salaryOf(p.start) + extra + arrivedBonus - savings;
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

  return {
    today,
    settings: { salary: s.salary, salary_day: s.salary_day, habit: s.habit, margin: s.margin, habit_left: leftSet ? s.habit_left : null },
    period: p,
    totals: {
      income: salaryOf(p.start) + extra + arrivedBonus,
      extra,
      bonus: arrivedBonus,
      spent,
      spentToday,
      spentBar,
      savings,
      toGoal: goalMode ? Math.max(0, goal.amount - balance) : 0,
      reserved,
      habitLeft: goalMode ? habitLeft : 0,
      budget,
      remaining,
      perDay: perDayNow,
      todayLeft,
    },
    balance,
    goal,
    goals,
    salaries: overrides.filter((o) => o.date >= p.start).map((o) => ({ ...o, standard: s.salary })),
    nextPayday: p.end,
    projection,
    closed: closedPeriods(history, p, s.salary_day),
    monthlyTarget: monthlyTarget(goalRows),
    recurring: rec,
    bonuses: bon,
    categories,
    transactions,
 };
}

// Obiettivo di risparmio mensile dedotto dagli obiettivi: la differenza tipica tra due scadenze consecutive
export function monthlyTarget(goalRows) {
  const d = [];
  for (let i = 1; i < goalRows.length; i++) d.push(goalRows[i].amount - goalRows[i - 1].amount);
  if (!d.length) return null;
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

// Ultimi periodi chiusi: quanto è cambiato il saldo tra la fine del periodo precedente e la fine di questo.
// Usa le fotografie giornaliere del saldo; senza una fotografia vicina al confine il mese non viene mostrato.
export function closedPeriods(history, p, salaryDay, max = 6) {
  if (!history.length) return [];
  const at = (day) => {
    let best = null;
    for (const h of history) if (h.date <= day && diffDays(h.date, day) <= 4) best = h;
    return best;
  };
  const out = [];
  let cur = period(addDaysStr(p.start, -1), salaryDay);
  for (let i = 0; i < max; i++) {
    const endB = at(addDaysStr(cur.end, -1));
    const prev = period(addDaysStr(cur.start, -1), salaryDay);
    const startB = at(addDaysStr(cur.start, -1));
    if (endB && startB && endB.date > startB.date) out.push({ start: cur.start, end: cur.end, from: startB.balance, to: endB.balance, change: endB.balance - startB.balance });
    cur = prev;
  }
  return out;
}
