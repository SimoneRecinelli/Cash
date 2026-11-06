import { handler, diffDays } from './_lib.js';
import { loadSummary, inboxList } from './_load.js';

export default handler(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo non consentito' });
  const { sql, s, today, result, history } = await loadSummary();

  // Fotografia giornaliera del saldo stimato: serve per i grafici e per i mesi chiusi
  if (result.balance !== null) {
    const bal = Math.round(result.balance * 100) / 100;
    await sql`INSERT INTO balance_history (date, balance) VALUES (${today}::date, ${bal})
      ON CONFLICT (date) DO UPDATE SET balance = EXCLUDED.balance WHERE balance_history.balance <> EXCLUDED.balance`;
    const i = history.findIndex((h) => h.date === today);
    if (i >= 0) history[i].balance = bal; else history.push({ date: today, balance: bal });
  }

  const checks = await sql`
    SELECT to_char(created_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS date,
           expected::float8 AS expected, actual::float8 AS actual, diff::float8 AS diff
    FROM balance_checks ORDER BY id DESC LIMIT 6`;
  const since = s.balance_date ? diffDays(s.balance_date, today) : null;

  res.status(200).json({
    ...result,
    inbox: await inboxList(sql),
    history,
    balanceCheck: { last: s.balance_date, daysSince: since, due: result.balance !== null && since !== null && since >= 7, recent: checks },
  });
});
