import { handler, db, todayStr } from './_lib.js';

const validDate = (s) =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;

export default handler(async (req, res) => {
  const sql = db();

  if (req.method === 'POST') {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const amount = Number(b.amount);
    const category = String(b.category || 'Altro').trim().slice(0, 40) || 'Altro';
    const note = String(b.note || '').trim().slice(0, 200);
    const date = b.date || todayStr();

    if (!['expense', 'income'].includes(b.type)) {
      return res.status(400).json({ error: 'Tipo non valido' });
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
      return res.status(400).json({ error: 'Importo non valido' });
    }
    if (!validDate(date)) return res.status(400).json({ error: 'Data non valida' });

    const amt = Math.round(amount * 100) / 100;
    const [row] = await sql`
      INSERT INTO transactions (type, amount, category, note, date)
      VALUES (${b.type}, ${amt}, ${category}, ${note}, ${date}::date)
      RETURNING id`;
    return res.status(201).json({ id: row.id });
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    await sql`DELETE FROM transactions WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'POST, DELETE');
  res.status(405).json({ error: 'Metodo non consentito' });
});
