import { handler } from '../_lib.js';
import { loadSummary } from '../_load.js';

// Controllo del saldo: confronti quello reale del conto con quello stimato dall'app.
// La differenza viene registrata e il saldo dell'app si allinea a quello reale.
export default handler(async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metodo non consentito' });
  }
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const actual = Number(b.actual);
  if (!Number.isFinite(actual) || Math.abs(actual) > 100_000_000) return res.status(400).json({ error: 'Saldo non valido' });

  const { sql, result } = await loadSummary();
  if (result.balance === null) return res.status(409).json({ error: 'Prima inserisci il saldo dalle impostazioni' });

  const expected = Math.round(result.balance * 100) / 100;
  const real = Math.round(actual * 100) / 100;
  const diff = Math.round((real - expected) * 100) / 100;
  await sql`INSERT INTO balance_checks (expected, actual, diff) VALUES (${expected}, ${real}, ${diff})`;
  await sql`UPDATE settings SET balance_ref = ${real}, balance_set_at = now() WHERE id = 1`;
  res.status(200).json({ expected, actual: real, diff });
});
