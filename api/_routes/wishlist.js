import { handler, db, todayStr } from '../_lib.js';

// Lista dei desideri: cosa vorresti comprare, con link, priorità (1 alta … 3 bassa) e rate previste.
// Il calendario "quando posso permettermelo" lo calcola l'app (public/sim-core.js) dal riepilogo.

// Accetta solo link http/https (niente javascript: e simili); senza schema aggiunge https://
export function cleanUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return { v: '' };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  if (u.length > 500) return { error: 'Link troppo lungo' };
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return { error: 'Il link deve iniziare con http o https' };
    return { v: x.toString() };
  } catch {
    return { error: 'Link non valido' };
  }
}

function parse(b) {
  b = b && typeof b === 'object' ? b : {};
  const name = String(b.name || '').trim().slice(0, 80);
  const price = Number(b.price);
  const priority = b.priority === undefined || b.priority === null || b.priority === '' ? 2 : Number(b.priority);
  const installments = b.installments === undefined || b.installments === null || b.installments === '' ? 1 : Number(b.installments);
  const note = String(b.note || '').trim().slice(0, 200);
  if (!name) return { error: 'Serve un nome' };
  if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) return { error: 'Prezzo non valido' };
  if (![1, 2, 3].includes(priority)) return { error: 'Priorità non valida' };
  if (!Number.isInteger(installments) || installments < 1 || installments > 60) return { error: 'Rate non valide (1-60)' };
  const pid = b.parent_id === undefined || b.parent_id === null || b.parent_id === '' ? null : Number(b.parent_id);
  if (pid !== null && (!Number.isInteger(pid) || pid < 1)) return { error: 'Accorpamento non valido' };
  const url = cleanUrl(b.url);
  if (url.error) return { error: url.error };
  return { v: { name, price: Math.round(price * 100) / 100, priority, installments, note, url: url.v, parent_id: pid } };
}

export default handler(async (req, res) => {
  const sql = db();

  if (req.method === 'GET') {
    const items = await sql`
      SELECT id, name, price::float8 AS price, url, priority, installments, note, parent_id,
             to_char(bought_at, 'YYYY-MM-DD') AS bought_at,
             to_char(created_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') || 'T' || lpad(id::text, 8, '0') AS created
      FROM wishlist ORDER BY priority, id`;
    return res.status(200).json({ items });
  }

  if (req.method === 'POST') {
    const { v, error } = parse(req.body);
    if (error) return res.status(400).json({ error });
    const [row] = await sql`
      INSERT INTO wishlist (name, price, url, priority, installments, note, parent_id)
      VALUES (${v.name}, ${v.price}, ${v.url}, ${v.priority}, ${v.installments}, ${v.note}, ${v.parent_id}) RETURNING id`;
    return res.status(201).json({ id: row.id });
  }

  if (req.method === 'PUT') {
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    // Solo "comprato": segna (o toglie) la data di acquisto
    if (b.bought !== undefined && b.name === undefined) {
      // se è un acquisto con accessori accorpati, comprato/non comprato vale anche per loro
      await sql`UPDATE wishlist SET bought_at = ${b.bought === true ? todayStr() : null}::date WHERE id = ${id} OR parent_id = ${id}`;
      return res.status(200).json({ ok: true });
    }
    const { v, error } = parse(b);
    if (error) return res.status(400).json({ error });
    if (v.parent_id === id) return res.status(400).json({ error: 'Non puoi accorpare un desiderio a se stesso' });
    const rows = await sql`
      UPDATE wishlist SET name = ${v.name}, price = ${v.price}, url = ${v.url}, priority = ${v.priority},
             installments = ${v.installments}, note = ${v.note}, parent_id = ${v.parent_id}
      WHERE id = ${id} RETURNING id`;
    if (!rows.length) return res.status(404).json({ error: 'Desiderio non trovato' });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });
    await sql`UPDATE wishlist SET parent_id = NULL WHERE parent_id = ${id}`; // gli accessori tornano desideri a sé
    await sql`DELETE FROM wishlist WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Metodo non consentito' });
});
