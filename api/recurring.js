import { handler, db } from './_lib.js';

// Spese ricorrenti (affitto, abbonamenti, rate…). Vengono riservate nel budget
// finché un SMS di Intesa non le conferma (vedi summary.js).
export default handler(async (req, res) => {
  const sql = db();

  if (req.method === 'POST') {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const name = String(b.name || '').trim().slice(0, 60);
    const match = String(b.match || '').trim().slice(0, 60);
    const amount = Number(b.amount);
    const day = Number(b.day);

    if (!name) return res.status(400).json({ error: 'Serve un nome' });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
      return res.status(400).json({ error: 'Importo non valido' });
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return res.status(400).json({ error: 'Giorno non valido (1-31)' });
    }

    const [row] = await sql`
      INSERT INTO recurring (name, amount, day, match)
      VALUES (${name}, ${Math.round(amount * 100) / 100}, ${day}, ${match})
      RETURNING id`;
    return res.status(201).json({ id: row.id });
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    await sql`DELETE FROM recurring WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'POST, DELETE');
  res.status(405).json({ error: 'Metodo non consentito' });
});
