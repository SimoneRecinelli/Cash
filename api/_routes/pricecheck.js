import { handler, db } from '../_lib.js';
import { fetchPrice } from '../_price.js';

// Monitoraggio prezzi della lista dei desideri: una volta al giorno (cron di Vercel) o a richiesta (POST dall'app).
// Legge il prezzo dalla pagina del link e lo confronta con quello che hai scritto tu. Non cambia mai il tuo prezzo da solo.
export default handler(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Metodo non consentito' });
  }
  const sql = db();
  const force = req.method === 'POST';
  // Il cron non forza: salta i controlli fatti da meno di 6 ore
  const items = await sql`
    SELECT id, url FROM wishlist
    WHERE bought_at IS NULL AND url <> '' AND (${force} OR seen_at IS NULL OR seen_at < now() - interval '6 hours')
    ORDER BY id LIMIT 15`;
  const results = await Promise.all(items.map(async (it) => ({ id: it.id, ...(await fetchPrice(it.url)) })));
  for (const r of results) {
    if (r.status === 'ok') {
      await sql`UPDATE wishlist SET seen_price = ${r.price}, seen_at = now(), seen_status = 'ok',
        low_price = LEAST(COALESCE(low_price, ${r.price}), ${r.price}) WHERE id = ${r.id}`;
    } else {
      // Se non riesco a leggerlo tengo l'ultimo prezzo valido e segno solo l'esito
      await sql`UPDATE wishlist SET seen_at = now(), seen_status = ${r.status} WHERE id = ${r.id}`;
    }
  }
  res.status(200).json({ ok: true, checked: results.length, read: results.filter((r) => r.status === 'ok').length });
}, { auth: 'cron' });
