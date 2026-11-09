// Logica del simulatore "posso permettermelo?" e del calendario dei desideri.
// Funzioni pure: ricevono il riepilogo (/api/summary) come argomento, nessuna dipendenza dal DOM.
// Si carica come script normale (window.SimCore) e nei test con vm.
(function (g) {
  const DAY = 86400000;
  const t0 = (iso) => Date.parse(iso + 'T12:00:00Z');
  const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
  const addDaysISO = (iso, k) => isoOf(t0(iso) + k * DAY);
  function addMonthsStr(iso, k) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = y * 12 + (m - 1) + k, ny = Math.floor(t / 12), nm = (t % 12) + 1;
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  }

  // Costo di un acquisto (prezzo in n rate dal giorno start) su ogni obiettivo ancora aperto
  function plan(data, price, n, start) {
    const goals = data.goals.filter((g) => !g.expired);
    const q = price / n;
    const dates = Array.from({ length: n }, (_, k) => addMonthsStr(start, k));
    const margin = (data.settings && data.settings.margin) || 0;
    const rows = goals.map((g) => {
      const cost = q * dates.filter((x) => x <= g.date).length;
      const before = g.spendable - margin;
      return { g, cost, before, after: before - cost };
    });
    const worst = rows.length ? rows.reduce((a, r) => (r.after < a.after ? r : a), rows[0]) : null;
    return { q, dates, rows, worst, margin };
  }

  function analyse(data, price, n, first) {
    const start = addMonthsStr(data.today, first);
    const p = plan(data, price, n, start);
    const rem = Math.max(0, data.totals.remaining);
    const habitLeft = data.totals.habitLeft || 0;
    const nowCost = p.q * p.dates.filter((x) => x < data.period.end).length;
    const hasGoals = p.rows.length > 0;
    let level;
    if (hasGoals) level = p.worst.after < 0 ? 'no' : nowCost > rem ? 'warn' : 'ok';
    else level = nowCost > rem ? 'no' : 'ok';

    const alt = {};
    if (hasGoals) {
      const goals = p.rows.map((r) => r.g);
      alt.maxNow = Math.max(0, Math.min(...goals.map((g) => g.spendable - p.margin)));
      if (level === 'no') {
        // prima data utile: ogni prossimo stipendio oppure il giorno dopo la scadenza di un obiettivo
        const lastG = goals[goals.length - 1].date;
        const cands = [];
        for (let k = 0; k < 24; k++) { const d = addMonthsStr(data.period.end, k); if (d > addDaysISO(lastG, 1)) break; cands.push(d); }
        goals.forEach((g) => cands.push(addDaysISO(g.date, 1)));
        for (const s of [...new Set(cands)].filter((x) => x > data.today).sort()) {
          const p2 = plan(data, price, n, s);
          const rest = p2.rows.filter((r) => r.g.date >= s);
          if (!rest.length || rest.every((r) => r.after >= 0)) { alt.when = { s, last: !rest.length }; break; }
        }
        for (let c = n + 1; c <= 60; c++) {
          if (plan(data, price, c, start).worst.after >= 0) { alt.rates = c; break; }
        }
      }
    }
    return { price, n, first, start, p, rem, habitLeft, nowCost, level, hasGoals, alt };
  }

  // Calendario dei desideri in ordine di priorità (1 = alta). Ogni acquisto prende la prima data in cui
  // regge insieme a quelli che lo precedono: i più importanti si prendono il margine per primi.
  //   status: 'now' (subito) | 'nextperiod' (dal prossimo stipendio) | 'later' (da una certa data) | 'free' (dopo l'ultimo obiettivo)
  function schedule(data, items) {
    const goals = data.goals.filter((g) => !g.expired);
    const margin = (data.settings && data.settings.margin) || 0;
    const periodEnd = data.period.end;
    const rem = Math.max(0, data.totals.remaining);
    const order = [...items].sort((a, b) => a.priority - b.priority || (a.created || '').localeCompare(b.created || '') || a.id - b.id);
    const committed = []; // {dates, q}
    const costOn = (g) => committed.reduce((s, c) => s + c.q * c.dates.filter((d) => d <= g.date).length, 0);
    const nowCostOf = () => committed.reduce((s, c) => s + c.q * c.dates.filter((d) => d < periodEnd).length, 0);
    // Possibili partenze: oggi, ogni prossimo stipendio (fino all'ultimo obiettivo) e il giorno dopo ogni scadenza
    const lastGoalDate = goals.length ? goals[goals.length - 1].date : periodEnd;
    const paydays = [];
    for (let k = 0; k < 24; k++) { const d = addMonthsStr(periodEnd, k); if (d > addDaysISO(lastGoalDate, 1)) break; paydays.push(d); }
    const starts = [data.today, periodEnd, ...paydays, ...goals.map((g) => addDaysISO(g.date, 1))]
      .filter((s, i, a) => a.indexOf(s) === i).sort();
    const out = new Map();
    for (const it of order) {
      const n = Math.max(1, it.installments || 1), q = it.price / n;
      let chosen = null;
      for (const s of starts) {
        const dates = Array.from({ length: n }, (_, k) => addMonthsStr(s, k));
        const worst = goals.length
          ? Math.min(...goals.map((g) => g.spendable - margin - costOn(g) - q * dates.filter((d) => d <= g.date).length))
          : Infinity;
        const nowCost = nowCostOf() + q * dates.filter((d) => d < periodEnd).length;
        if (worst >= 0 && nowCost <= rem) { chosen = { s, dates, worst }; break; }
      }
      if (!chosen) { // nemmeno così: dopo l'ultimo obiettivo e con il periodo libero
        const s = goals.length ? addDaysISO(goals[goals.length - 1].date, 1) : periodEnd;
        chosen = { s, dates: Array.from({ length: n }, (_, k) => addMonthsStr(s, k)), worst: Infinity };
      }
      const lastGoal = goals.length ? goals[goals.length - 1].date : null;
      const status = chosen.s === data.today ? 'now'
        : chosen.s === periodEnd ? 'nextperiod'
        : !lastGoal || chosen.s > lastGoal ? 'free' : 'later';
      committed.push({ dates: chosen.dates, q });
      out.set(it.id, { id: it.id, status, start: chosen.s, last: chosen.dates[n - 1], q, n, margin: Number.isFinite(chosen.worst) ? chosen.worst : null });
    }
    return order.map((it) => ({ ...it, plan: out.get(it.id) }));
  }

  g.SimCore = { addMonthsStr, addDaysISO, plan, analyse, schedule };
})(typeof window !== 'undefined' ? window : globalThis);
