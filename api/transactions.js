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
    // inBalance: il pagamento è già compreso nel saldo inserito → lo registro "prima" del saldo, così non viene detratto di nuovo
    const [row] = b.inBalance === true
      ? await sql`
          INSERT INTO transactions (type, amount, category, note, date, created_at)
          VALUES (${b.type}, ${amt}, ${category}, ${note}, ${date}::date,
                  COALESCE((SELECT balance_set_at FROM settings WHERE id = 1) - interval '1 minute', now()))
          RETURNING id`
      : await sql`
          INSERT INTO transactions (type, amount, category, note, date)
          VALUES (${b.type}, ${amt}, ${category}, ${note}, ${date}::date)
          RETURNING id`;
    return res.status(201).json({ id: row.id });
  }

  if (req.method === 'PUT') {
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const amount = Number(b.amount);
    const category = String(b.category || 'Altro').trim().slice(0, 40) || 'Altro';
    const note = String(b.note || '').trim().slice(0, 200);
    if (!['expense', 'income'].includes(b.type)) return res.status(400).json({ error: 'Tipo non valido' });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return res.status(400).json({ error: 'Importo non valido' });
    if (!validDate(b.date)) return res.status(400).json({ error: 'Data non valida' });
    const rows = await sql`
      UPDATE transactions
      SET type = ${b.type}, amount = ${Math.round(amount * 100) / 100}, category = ${category}, note = ${note}, date = ${b.date}::date
      WHERE id = ${id} RETURNING id`;
    if (!rows.length) return res.status(404).json({ error: 'Movimento non trovato' });
    // “Ricorda”: da ora i movimenti di questo negozio finiscono in questa categoria
    if (b.remember === true && note) {
      await sql`
        INSERT INTO category_rules (pattern, category) VALUES (${note.toLowerCase().slice(0, 60)}, ${category})
        ON CONFLICT (pattern) DO UPDATE SET category = EXCLUDED.category`;
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    await sql`DELETE FROM transactions WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'POST, PUT, DELETE');
  res.status(405).json({ error: 'Metodo non consentito' });
});
