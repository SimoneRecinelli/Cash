import { createHash } from 'node:crypto';
import { handler, db, todayStr } from './_lib.js';
import { parseBankMessage, applyRules } from './_parse.js';

// Riceve il testo di un SMS bancario (da un'automazione di Comandi su iPhone)
// e registra da solo la spesa/entrata. Header richiesto: x-app-key.
export default handler(async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metodo non consentito' });
  }
  const b = req.body;
  const text = typeof b === 'string' ? b : b && typeof b === 'object' ? b.text : '';

  if (typeof text !== 'string' || text.length > 20000) return res.status(413).json({ error: 'Testo non valido' });
  const p = parseBankMessage(text);
  if (p.ignore) return res.status(200).json({ ok: true, ignored: true, reason: p.reason });

  // Anti-doppione: stesso testo ripetuto entro 2 minuti (es. retry) = una sola riga.
  const bucket = Math.floor(Date.now() / 120000);
  const hash = createHash('sha256').update(`${String(text).trim()}|${bucket}`).digest('hex');
  const sql = db();

  if (p.error) {
    // Non l'ho capito: lo tengo in "Da controllare" invece di perderlo
    const r = await sql`
      INSERT INTO inbox (text, reason, raw_hash) VALUES (${String(text).trim().slice(0, 3000)}, ${p.error}, ${hash})
      ON CONFLICT (raw_hash) DO NOTHING RETURNING id`;
    return res.status(202).json({ ok: true, inbox: true, duplicate: !r.length, reason: p.error });
  }

  const rules = await sql`SELECT pattern, category FROM category_rules`;
  p.category = applyRules(rules, p.merchant, p.category);

  const rows = await sql`
    INSERT INTO transactions (type, amount, category, note, date, raw_hash)
    VALUES (${p.type}, ${p.amount}, ${p.category}, ${p.merchant}, ${todayStr()}::date, ${hash})
    ON CONFLICT (raw_hash) DO NOTHING
    RETURNING id`;

  res.status(rows.length ? 201 : 200).json({
    ok: true,
    duplicate: !rows.length,
    type: p.type,
    amount: p.amount,
    merchant: p.merchant,
    category: p.category,
  });
}, { auth: 'ingest' });
