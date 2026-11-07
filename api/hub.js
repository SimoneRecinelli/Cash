import balance from './_routes/balance.js';
import bonuses from './_routes/bonuses.js';
import goals from './_routes/goals.js';
import inbox from './_routes/inbox.js';
import salaries from './_routes/salaries.js';
import wishlist from './_routes/wishlist.js';

// Vercel (piano gratuito) consente al massimo 12 funzioni: gli endpoint minori stanno dietro a questa sola,
// scelti dal parametro ?r=nome. L'app li chiama come /api/hub?r=wishlist (vedi api() in index.html).
// Ogni rotta ha comunque la sua autenticazione (handler in _lib.js).
export const routes = { balance, bonuses, goals, inbox, salaries, wishlist };

export default async function hub(req, res) {
  const route = routes[String(req.query && req.query.r)];
  if (!route) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'Non trovato' });
  }
  return route(req, res);
}
