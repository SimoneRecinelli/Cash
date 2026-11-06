import { handler, recordFail, clearFails, checkTotp, makeToken } from './_lib.js';
import { timingSafeEqual, createHash } from 'node:crypto';

const eq = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());

// Accesso: chiave + codice a 6 cifre (se TOTP_SECRET è impostata) -> token di sessione (14 giorni).
export default handler(async (req, res) => {
  if (req.method === 'GET') return res.status(200).json({ twofa: !!process.env.TOTP_SECRET });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Metodo non consentito' });
  }
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const keyOk = eq(b.key || '', process.env.APP_KEY || '');
  // Il codice si consuma solo se la chiave è giusta (un errore di digitazione non brucia il codice)
  const codeOk = keyOk && (await checkTotp(b.code));
  if (!keyOk || !codeOk) {
    await recordFail(req.ip);
    return res.status(401).json({ error: process.env.TOTP_SECRET ? 'Chiave o codice non validi' : 'Chiave non valida' });
  }
  await clearFails(req.ip);
  res.status(200).json({ token: makeToken(), twofa: !!process.env.TOTP_SECRET });
}, { auth: 'none' });
