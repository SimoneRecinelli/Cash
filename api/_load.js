import { db, todayStr, period } from './_lib.js';
import { computeSummary } from './_calc.js';
import { guessFromText } from './_parse.js';

// Legge dal database tutto ciò che serve al riepilogo e lo calcola (usato da summary, balance, widget).
export async function loadSummary() {
  const sql = db();

  const [s] = await sql`
    SELECT salary::float8 AS salary, salary_day, savings_goal::float8 AS savings_goal,
           habit_monthly::float8 AS habit, habit_left::float8 AS habit_left,
           to_char(habit_left_for, 'YYYY-MM-DD') AS habit_left_for, safety_margin::float8 AS margin,
           balance_ref::float8 AS balance_ref,
           to_char(balance_set_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS balance_date
    FROM settings WHERE id = 1`;

  const today = todayStr();
  const p = period(today, s.salary_day);

  const [transactions, recurring, bonuses, delta, goalRows, overrides, history] = await Promise.all([
    sql`SELECT id, type, amount::float8 AS amount, category, note,
               to_char(date, 'YYYY-MM-DD') AS date,
               (created_at > (SELECT balance_set_at FROM settings WHERE id = 1)) AS fresh, refund
        FROM transactions
        WHERE date >= ${p.start}::date AND date < ${p.end}::date
        ORDER BY date DESC, id DESC LIMIT 1000`,
    sql`SELECT id, name, amount::float8 AS amount, day, match, flex, installment,
               to_char(starts, 'YYYY-MM-DD') AS starts, to_char(until, 'YYYY-MM-DD') AS until
        FROM recurring ORDER BY day, id`,
    sql`SELECT id, name, month, day, amount::float8 AS amount FROM bonuses ORDER BY month, day, id`,
    // Movimenti registrati dopo l'ultima volta in cui hai inserito il saldo
    sql`SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0)::float8 AS d
        FROM transactions
        WHERE created_at > (SELECT balance_set_at FROM settings WHERE id = 1) AND NOT refund`,
    sql`SELECT id, amount::float8 AS amount, to_char(date, 'YYYY-MM-DD') AS date FROM goals ORDER BY date, id`,
    sql`SELECT to_char(date, 'YYYY-MM-DD') AS date, amount::float8 AS amount FROM salary_overrides ORDER BY date`,
    sql`SELECT to_char(date, 'YYYY-MM-DD') AS date, balance::float8 AS balance FROM balance_history
        WHERE date >= (${p.start}::date - interval '200 days') ORDER BY date`,
  ]);

  const result = computeSummary({ s, today, transactions, recurring, bonuses, delta, goalRows, overrides, history });
  return { sql, s, today, result, history };
}

export async function inboxList(sql) {
  const rows = await sql`
    SELECT id, text, reason, to_char(created_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS date
    FROM inbox WHERE status = 'new' ORDER BY id DESC LIMIT 20`;
  return rows.map((m) => ({ ...m, guess: guessFromText(m.text) }));
}
