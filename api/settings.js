import { handler, db } from './_lib.js';

const validDate = (s) =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  new Date(s).toISOString().slice(0, 10) === s;

export default handler(async (req, res) => {
  const sql = db();

  if (req.method === 'GET') {
    const [s] = await sql`
      SELECT salary::float8 AS salary, salary_day, savings_goal::float8 AS savings_goal,
             goal_amount::float8 AS goal_amount, to_char(goal_date, 'YYYY-MM-DD') AS goal_date
      FROM settings WHERE id = 1`;
    return res.status(200).json(s);
  }

  if (req.method === 'PUT') {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const salary = Number(b.salary);
    const day = Number(b.salary_day);
    const goalAmount = b.goal_amount ? Number(b.goal_amount) : null;
    const goalDate = b.goal_date || null;
    const hasBalance = b.balance !== undefined && b.balance !== null && b.balance !== '';
    const balance = hasBalance ? Number(b.balance) : null;

    if (!Number.isFinite(salary) || salary < 0 || salary > 10_000_000) {
      return res.status(400).json({ error: 'Stipendio non valido' });
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return res.status(400).json({ error: 'Giorno non valido (1-31)' });
    }
    if ((goalAmount === null) !== (goalDate === null)) {
      return res.status(400).json({ error: "Per l'obiettivo servono sia la cifra sia la data" });
    }
    if (goalAmount !== null && (!Number.isFinite(goalAmount) || goalAmount <= 0 || goalAmount > 100_000_000)) {
      return res.status(400).json({ error: 'Cifra obiettivo non valida' });
    }
    if (goalDate !== null && !validDate(goalDate)) {
      return res.status(400).json({ error: 'Data obiettivo non valida' });
    }
    if (hasBalance && (!Number.isFinite(balance) || Math.abs(balance) > 100_000_000)) {
      return res.status(400).json({ error: 'Saldo non valido' });
    }
    if (goalAmount !== null && !hasBalance) {
      const [cur] = await sql`SELECT balance_ref FROM settings WHERE id = 1`;
      if (cur.balance_ref === null) {
        return res.status(400).json({ error: 'Per l’obiettivo inserisci anche il saldo attuale del conto' });
      }
    }

    await sql`
      UPDATE settings
      SET salary = ${Math.round(salary * 100) / 100},
          salary_day = ${day},
          goal_amount = ${goalAmount === null ? null : Math.round(goalAmount * 100) / 100},
          goal_date = ${goalDate}::date
      WHERE id = 1`;
    if (hasBalance) {
      await sql`UPDATE settings SET balance_ref = ${Math.round(balance * 100) / 100}, balance_set_at = now() WHERE id = 1`;
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, PUT');
  res.status(405).json({ error: 'Metodo non consentito' });
});
