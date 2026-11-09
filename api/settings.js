import { handler, db, todayStr, period } from './_lib.js';

export default handler(async (req, res) => {
  const sql = db();

  if (req.method === 'GET') {
    const [s] = await sql`
      SELECT salary::float8 AS salary, salary_day, savings_goal::float8 AS savings_goal,
             habit_monthly::float8 AS habit_monthly, habit_weekly::float8 AS habit_weekly, safety_margin::float8 AS safety_margin
      FROM settings WHERE id = 1`;
    return res.status(200).json(s);
  }

  if (req.method === 'PUT') {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const salary = Number(b.salary);
    const day = Number(b.salary_day);
    const margin = b.safety_margin === undefined || b.safety_margin === '' || b.safety_margin === null ? 0 : Number(b.safety_margin);
    const habit = b.habit_monthly === undefined || b.habit_monthly === '' || b.habit_monthly === null ? 0 : Number(b.habit_monthly);
    const weekly = b.habit_weekly === undefined || b.habit_weekly === '' || b.habit_weekly === null ? 0 : Number(b.habit_weekly);
    const hasLeft = b.habit_left !== undefined && b.habit_left !== null && b.habit_left !== '';
    const left = hasLeft ? Number(b.habit_left) : null;
    if (hasLeft && (!Number.isFinite(left) || left < 0 || left > 10_000_000)) {
      return res.status(400).json({ error: 'Cene previste non valide' });
    }
    const hasBalance = b.balance !== undefined && b.balance !== null && b.balance !== '';
    const balance = hasBalance ? Number(b.balance) : null;

    if (!Number.isFinite(salary) || salary < 0 || salary > 10_000_000) {
      return res.status(400).json({ error: 'Stipendio non valido' });
    }
    if (!Number.isFinite(habit) || habit < 0 || habit > 10_000_000) {
      return res.status(400).json({ error: 'Spesa abituale non valida' });
    }
    if (!Number.isFinite(weekly) || weekly < 0 || weekly > 100_000) {
      return res.status(400).json({ error: 'Cena del sabato non valida' });
    }
    if (!Number.isFinite(margin) || margin < 0 || margin > 10_000_000) {
      return res.status(400).json({ error: 'Margine di sicurezza non valido' });
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return res.status(400).json({ error: 'Giorno non valido (1-31)' });
    }
    if (hasBalance && (!Number.isFinite(balance) || Math.abs(balance) > 100_000_000)) {
      return res.status(400).json({ error: 'Saldo non valido' });
    }
    await sql`
      UPDATE settings
      SET salary = ${Math.round(salary * 100) / 100},
          salary_day = ${day},
          habit_weekly = ${Math.round(weekly * 100) / 100},
          safety_margin = ${Math.round(margin * 100) / 100}
      WHERE id = 1`;
    {
      const [cur] = await sql`SELECT salary_day FROM settings WHERE id = 1`;
      const start = period(todayStr(), cur.salary_day).start;
      await sql`UPDATE settings SET habit_left = ${left === null ? null : Math.round(left * 100) / 100},
        habit_left_for = ${left === null ? null : start}::date WHERE id = 1`;
    }
    if (hasBalance) {
      await sql`UPDATE settings SET balance_ref = ${Math.round(balance * 100) / 100}, balance_set_at = now() WHERE id = 1`;
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, PUT');
  res.status(405).json({ error: 'Metodo non consentito' });
});
