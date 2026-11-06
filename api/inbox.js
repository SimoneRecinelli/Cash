import { handler, db, todayStr } from './_lib.js';

// Messaggi della banca che il parser non ha saputo registrare: li confermi o li scarti a mano.
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s).toISOString().slice(0, 10) === s;

export default handler(async (req, res) => {
  const sql = db();

  if (req.method === 'POST') {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const id = Number(b.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });

    if (b.action === 'dismiss') {
      await sql`UPDATE inbox SET status = 'dismissed' WHERE id = ${id} AND status = 'new'`;
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'confirm') {
      const amount = Number(b.amount);
      const category = String(b.category || 'Altro').trim().slice(0, 40) || 'Altro';
      const note = String(b.note || '').trim().slice(0, 200);
      const date = b.date || todayStr();
      if (!['expense', 'income'].includes(b.type)) return res.status(400).json({ error: 'Tipo non valido' });
      if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return res.status(400).json({ error: 'Importo non valido' });
      if (!validDate(date)) return res.status(400).json({ error: 'Data non valida' });
      // Prima chiudo il messaggio (solo se ancora nuovo): un doppio tocco non registra due volte
      const done = await sql`UPDATE inbox SET status = 'done' WHERE id = ${id} AND status = 'new' RETURNING id`;
      if (!done.length) return res.status(409).json({ error: 'Messaggio già gestito' });
      await sql`
        INSERT INTO transactions (type, amount, category, note, date)
        VALUES (${b.type}, ${Math.round(amount * 100) / 100}, ${category}, ${note}, ${date}::date)`;
      return res.status(201).json({ ok: true });
    }
    return res.status(400).json({ error: 'Azione non valida' });
  }

  res.setHeader('Allow', 'POST');
  res.status(405).json({ error: 'Metodo non consentito' });
});
