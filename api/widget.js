import { handler } from './_lib.js';
import { loadSummary } from './_load.js';

// Per widget e notifiche sull'iPhone (Scriptable / Comandi). Sola lettura, chiave WIDGET_KEY.
// Espone il minimo: niente saldo, niente movimenti.
const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Math.round(n));
const dayMonth = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });

export default handler(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo non consentito' });
  const { result: r } = await loadSummary();
  const t = r.totals;
  const free = Math.max(0, t.remaining - t.habitLeft); // oltre la cena
  const text = t.remaining < 0
    ? `Hai superato il budget di ${eur(-t.remaining)} fino al ${dayMonth(r.nextPayday)}.`
    : `Ti restano ${eur(t.remaining)} fino al ${dayMonth(r.nextPayday)}` + (t.habitLeft > 0 ? `: ${eur(t.habitLeft)} per le cene e ${eur(free)} oltre.` : '.');
  res.status(200).json({
    remaining: Math.round(t.remaining * 100) / 100,
    dinners: Math.round(t.habitLeft * 100) / 100,
    beyond: Math.round(free * 100) / 100,
    nextPayday: r.nextPayday,
    daysLeft: r.period.daysLeft,
    over: t.remaining < 0,
    text,
  });
}, { auth: 'widget' });
