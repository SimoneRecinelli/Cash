import { handler, db } from './_lib.js';

const validDate = (s) =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  new Date(s).toISOString().slice(0, 10) === s;

// Stipendio diverso dallo standard per un certo mese (data dell'accredito indicata nelle impostazioni).
export default handler(async (req, res) => {
  const sql = db();

  if (req.method === 'POST') {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) {
      return res.status(400).json({ error: 'Importo non valido' });
    }
    if (!validDate(b.date)) return res.status(400).json({ error: 'Data non valida' });
    // Qualunque data del mese vale: la aggancio al giorno di stipendio di quel mese
    const [{ salary_day: sd }] = await sql`SELECT salary_day FROM settings WHERE id = 1`;
    const [y, m] = b.date.split('-').map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const date = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(sd, dim)).padStart(2, '0')}`;
    await sql`
      INSERT INTO salary_overrides (date, amount) VALUES (${date}::date, ${Math.round(amount * 100) / 100})
      ON CONFLICT (date) DO UPDATE SET amount = EXCLUDED.amount`;
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    if (!validDate(req.query.date)) return res.status(400).json({ error: 'Data non valida' });
    await sql`DELETE FROM salary_overrides WHERE date = ${req.query.date}::date`;
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'POST, DELETE');
  res.status(405).json({ error: 'Metodo non consentito' });
});
