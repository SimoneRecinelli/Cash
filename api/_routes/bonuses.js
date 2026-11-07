import { handler, db } from '../_lib.js';

// Mensilità aggiuntive annuali (tredicesima, quattordicesima, premi…): importo netto atteso
// e data di accredito. Contano come entrata nel periodo in cui arrivano.
export default handler(async (req, res) => {
  const sql = db();

  if (req.method === 'POST') {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const name = String(b.name || '').trim().slice(0, 60);
    const amount = Number(b.amount);
    const month = Number(b.month);
    const day = Number(b.day);

    if (!name) return res.status(400).json({ error: 'Serve un nome' });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
      return res.status(400).json({ error: 'Importo non valido' });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Mese non valido' });
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return res.status(400).json({ error: 'Giorno non valido (1-31)' });
    }

    const [row] = await sql`
      INSERT INTO bonuses (name, month, day, amount)
      VALUES (${name}, ${month}, ${day}, ${Math.round(amount * 100) / 100})
      RETURNING id`;
    return res.status(201).json({ id: row.id });
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    await sql`DELETE FROM bonuses WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'POST, DELETE');
  res.status(405).json({ error: 'Metodo non consentito' });
});
