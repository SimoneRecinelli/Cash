import { handler, db } from './_lib.js';

// Spese ricorrenti mensili (abbonamenti, rate…), con inizio e fine facoltativi
// (es. l'ultima rata di un acquisto). Vengono riservate nel budget finché un SMS
// di Intesa non le conferma (vedi summary.js).

const validDate = (s) =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  new Date(s).toISOString().slice(0, 10) === s;

function parse(b) {
  b = b && typeof b === 'object' ? b : {};
  const out = {
    name: String(b.name || '').trim().slice(0, 60),
    match: String(b.match || '').trim().slice(0, 60),
    amount: Number(b.amount),
    day: Number(b.day),
    starts: b.starts || null,
    until: b.until || null,
  };
  if (!out.name) return { error: 'Serve un nome' };
  if (!Number.isFinite(out.amount) || out.amount <= 0 || out.amount > 10_000_000) return { error: 'Importo non valido' };
  if (!Number.isInteger(out.day) || out.day < 1 || out.day > 31) return { error: 'Giorno non valido (1-31)' };
  if (out.starts && !validDate(out.starts)) return { error: 'Data di inizio non valida' };
  if (out.until && !validDate(out.until)) return { error: 'Data di fine non valida' };
  if (out.starts && out.until && out.until < out.starts) return { error: 'La fine è prima dell’inizio' };
  out.amount = Math.round(out.amount * 100) / 100;
  return { v: out };
}

export default handler(async (req, res) => {
  const sql = db();

  if (req.method === 'POST') {
    const { v, error } = parse(req.body);
    if (error) return res.status(400).json({ error });
    const [row] = await sql`
      INSERT INTO recurring (name, amount, day, match, starts, until)
      VALUES (${v.name}, ${v.amount}, ${v.day}, ${v.match}, ${v.starts}::date, ${v.until}::date)
      RETURNING id`;
    return res.status(201).json({ id: row.id });
  }

  if (req.method === 'PUT') {
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    const { v, error } = parse(req.body);
    if (error) return res.status(400).json({ error });
    await sql`
      UPDATE recurring
      SET name = ${v.name}, amount = ${v.amount}, day = ${v.day}, match = ${v.match},
          starts = ${v.starts}::date, until = ${v.until}::date
      WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    await sql`DELETE FROM recurring WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'POST, PUT, DELETE');
  res.status(405).json({ error: 'Metodo non consentito' });
});
