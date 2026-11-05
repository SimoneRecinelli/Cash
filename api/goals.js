import { handler, db } from './_lib.js';

const validDate = (s) =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  new Date(s).toISOString().slice(0, 10) === s;

// Obiettivi sul saldo del conto: cifra da raggiungere entro una data. Se ce n'è più
// d'uno, il budget segue quello che stringe di più (vedi summary.js).
export default handler(async (req, res) => {
  const sql = db();

  if (req.method === 'POST') {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
      return res.status(400).json({ error: 'Cifra obiettivo non valida' });
    }
    if (!validDate(b.date)) return res.status(400).json({ error: 'Data obiettivo non valida' });
    const [cur] = await sql`SELECT balance_ref FROM settings WHERE id = 1`;
    if (cur.balance_ref === null) {
      return res.status(400).json({ error: 'Per gli obiettivi inserisci prima il saldo attuale del conto (Impostazioni)' });
    }
    const [row] = await sql`
      INSERT INTO goals (amount, date) VALUES (${Math.round(amount * 100) / 100}, ${b.date}::date)
      RETURNING id`;
    return res.status(201).json({ id: row.id });
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    await sql`DELETE FROM goals WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'POST, DELETE');
  res.status(405).json({ error: 'Metodo non consentito' });
});
