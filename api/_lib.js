import { neon } from '@neondatabase/serverless';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const TZ = 'Europe/Rome';

let _sql;
// Solo per i test: sostituisce il database con uno finto
export function setDbForTests(fake) {
  _sql = fake;
  ready = Promise.resolve();
}

export function db() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL mancante');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

// Crea le tabelle al primo utilizzo (una volta per cold start).
let ready;
function init() {
  if (!ready) {
    const sql = db();
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS settings (
        id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        salary numeric(12,2) NOT NULL DEFAULT 0,
        salary_day int NOT NULL DEFAULT 27 CHECK (salary_day BETWEEN 1 AND 31),
        savings_goal numeric(12,2) NOT NULL DEFAULT 0
      )`;
      await sql`INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING`;
      await sql`CREATE TABLE IF NOT EXISTS transactions (
        id serial PRIMARY KEY,
        type text NOT NULL CHECK (type IN ('expense','income')),
        amount numeric(12,2) NOT NULL CHECK (amount > 0),
        category text NOT NULL DEFAULT 'Altro',
        note text NOT NULL DEFAULT '',
        date date NOT NULL DEFAULT CURRENT_DATE,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions (date)`;
      await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS raw_hash text`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS transactions_raw_hash_idx ON transactions (raw_hash)`;
      await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS balance_ref numeric(14,2)`;
      await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS balance_set_at timestamptz`;
      await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS habit_monthly numeric(12,2) NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS safety_margin numeric(12,2) NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS habit_left numeric(12,2)`;
      await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS habit_left_for date`;
      await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS goal_amount numeric(14,2)`;
      await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS goal_date date`;
      await sql`CREATE TABLE IF NOT EXISTS goals (
        id serial PRIMARY KEY,
        amount numeric(14,2) NOT NULL CHECK (amount > 0),
        date date NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      // Migrazione: l'obiettivo singolo delle impostazioni diventa la prima riga di goals
      await sql`INSERT INTO goals (amount, date)
        SELECT goal_amount, goal_date FROM settings
        WHERE id = 1 AND goal_amount IS NOT NULL AND goal_date IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM goals)`;
      await sql`UPDATE settings SET goal_amount = NULL, goal_date = NULL WHERE id = 1`;
      await sql`CREATE TABLE IF NOT EXISTS bonuses (
        id serial PRIMARY KEY,
        name text NOT NULL,
        month int NOT NULL CHECK (month BETWEEN 1 AND 12),
        day int NOT NULL CHECK (day BETWEEN 1 AND 31),
        amount numeric(12,2) NOT NULL CHECK (amount > 0),
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS salary_overrides (
        date date PRIMARY KEY,
        amount numeric(12,2) NOT NULL CHECK (amount >= 0),
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS recurring (
        id serial PRIMARY KEY,
        name text NOT NULL,
        amount numeric(12,2) NOT NULL CHECK (amount > 0),
        day int NOT NULL CHECK (day BETWEEN 1 AND 31),
        match text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`ALTER TABLE recurring ADD COLUMN IF NOT EXISTS starts date`;
      await sql`ALTER TABLE recurring ADD COLUMN IF NOT EXISTS until date`;
      await sql`ALTER TABLE recurring ADD COLUMN IF NOT EXISTS flex boolean NOT NULL DEFAULT false`;
      await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refund boolean NOT NULL DEFAULT false`;
      await sql`ALTER TABLE recurring ADD COLUMN IF NOT EXISTS installment boolean NOT NULL DEFAULT false`;
      await sql`CREATE TABLE IF NOT EXISTS inbox (
        id serial PRIMARY KEY,
        text text NOT NULL,
        reason text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','done','dismissed')),
        raw_hash text UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS balance_checks (
        id serial PRIMARY KEY,
        expected numeric(14,2) NOT NULL,
        actual numeric(14,2) NOT NULL,
        diff numeric(14,2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS balance_history (
        date date PRIMARY KEY,
        balance numeric(14,2) NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS wishlist (
        id serial PRIMARY KEY,
        name text NOT NULL,
        price numeric(12,2) NOT NULL CHECK (price > 0),
        url text NOT NULL DEFAULT '',
        priority int NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
        installments int NOT NULL DEFAULT 1 CHECK (installments BETWEEN 1 AND 60),
        note text NOT NULL DEFAULT '',
        bought_at date,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`ALTER TABLE wishlist ADD COLUMN IF NOT EXISTS parent_id int`;
      await sql`ALTER TABLE wishlist ADD COLUMN IF NOT EXISTS seen_price numeric(12,2)`;
      await sql`ALTER TABLE wishlist ADD COLUMN IF NOT EXISTS low_price numeric(12,2)`;
      await sql`ALTER TABLE wishlist ADD COLUMN IF NOT EXISTS seen_at timestamptz`;
      await sql`ALTER TABLE wishlist ADD COLUMN IF NOT EXISTS seen_status text NOT NULL DEFAULT ''`;
      await sql`CREATE TABLE IF NOT EXISTS category_rules (
        id serial PRIMARY KEY,
        pattern text NOT NULL UNIQUE,
        category text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS totp_last bigint`;
      await sql`CREATE TABLE IF NOT EXISTS auth_fails (
        ip text PRIMARY KEY,
        fails int NOT NULL DEFAULT 0,
        window_start timestamptz NOT NULL DEFAULT now()
      )`;
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

// ---- Autenticazione ----
const sha = (s) => createHash('sha256').update(String(s)).digest();
const safeEq = (a, b) => timingSafeEqual(sha(a), sha(b)); // hash: stessa lunghezza, niente leak sulla lunghezza
const SESSION_MS = 14 * 24 * 3600 * 1000;
const MAX_FAILS = 8; // tentativi sbagliati per IP ...
const WINDOW_MIN = 15; // ... ogni 15 minuti

const sessionKey = () => sha(`sess|${process.env.APP_KEY || ''}|${process.env.TOTP_SECRET || ''}`);
export function makeToken() {
  const exp = String(Date.now() + SESSION_MS);
  return `${exp}.${createHmac('sha256', sessionKey()).update(exp).digest('hex')}`;
}
function validToken(tok) {
  const [exp, sig] = String(tok || '').split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  const want = createHmac('sha256', sessionKey()).update(exp).digest('hex');
  return safeEq(sig, want);
}

export const clientIp = (req) =>
  String(req.headers['x-real-ip'] || req.headers['x-vercel-forwarded-for'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();

export async function isLocked(ip) {
  const [r] = await db()`SELECT fails FROM auth_fails WHERE ip = ${ip} AND window_start > now() - make_interval(mins => ${WINDOW_MIN})`;
  return !!r && r.fails >= MAX_FAILS;
}
export async function recordFail(ip) {
  await db()`INSERT INTO auth_fails (ip, fails, window_start) VALUES (${ip}, 1, now())
    ON CONFLICT (ip) DO UPDATE SET
      fails = CASE WHEN auth_fails.window_start > now() - make_interval(mins => ${WINDOW_MIN}) THEN auth_fails.fails + 1 ELSE 1 END,
      window_start = CASE WHEN auth_fails.window_start > now() - make_interval(mins => ${WINDOW_MIN}) THEN auth_fails.window_start ELSE now() END`;
}
export async function clearFails(ip) {
  await db()`DELETE FROM auth_fails WHERE ip = ${ip}`;
}

// ---- TOTP (RFC 6238, 6 cifre, 30 s) ----
function b32decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totpAt(secret, step) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
// Verifica il codice (±1 intervallo) e impedisce di riusarlo.
export async function checkTotp(code) {
  const secret = process.env.TOTP_SECRET;
  if (!secret) return true;
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const now = Math.floor(Date.now() / 30000);
  for (const step of [now, now - 1, now + 1]) {
    if (safeEq(totpAt(secret, step), c)) {
      const r = await db()`UPDATE settings SET totp_last = ${step} WHERE id = 1 AND (totp_last IS NULL OR totp_last < ${step}) RETURNING id`;
      return r.length === 1;
    }
  }
  return false;
}

// auth: 'session' (default, app) | 'ingest' (solo /api/ingest) | 'widget' (sola lettura) | 'none' (login: se la gestisce da sé)
function authorized(req, mode) {
  const appKey = process.env.APP_KEY || '';
  const hdrKey = String(req.headers['x-app-key'] || '');
  if (mode === 'cron') {
    // Cron di Vercel (user-agent vercel-cron, oppure CRON_SECRET se impostata) o app con sessione valida.
    // L'azione è innocua (legge pagine di negozi e salva un prezzo) e limitata a un controllo ogni 6 ore.
    const cs = process.env.CRON_SECRET || '';
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (cs ? safeEq(bearer, cs) : /^vercel-cron\//i.test(String(req.headers['user-agent'] || ''))) return true;
    return authorized(req, 'session');
  }
  if (mode === 'widget') {
    // Sola lettura per widget/notifiche: chiave propria, disattivata finché WIDGET_KEY non è impostata
    const wk = process.env.WIDGET_KEY || '';
    return !!wk && safeEq(String(req.headers['x-widget-key'] || ''), wk);
  }
  if (mode === 'ingest') {
    const ik = process.env.INGEST_KEY || '';
    // Con INGEST_KEY impostata, la chiave principale NON apre più l'ingest
    return ik ? safeEq(hdrKey, ik) : safeEq(hdrKey, appKey);
  }
  if (validToken(req.headers['x-session'])) return true;
  // Compatibilità: senza 2FA configurata resta valida la chiave diretta
  return !process.env.TOTP_SECRET && !!hdrKey && safeEq(hdrKey, appKey);
}

export function handler(fn, { auth = 'session' } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!process.env.APP_KEY) {
        return res.status(500).json({ error: 'APP_KEY non configurata su Vercel' });
      }
      await init();
      const ip = clientIp(req);
      if (await isLocked(ip)) {
        res.setHeader('Retry-After', String(WINDOW_MIN * 60));
        return res.status(429).json({ error: 'Troppi tentativi. Riprova tra qualche minuto.' });
      }
      if (auth !== 'none' && !authorized(req, auth)) {
        await recordFail(ip);
        return res.status(401).json({ error: 'Non autorizzato' });
      }
      req.ip = ip;
      await fn(req, res);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Errore del server' });
    }
  };
}

// ---- Date (tutto in YYYY-MM-DD, fuso Europe/Rome) ----

export function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const addMonths = (y, m, delta) => {
  const t = y * 12 + (m - 1) + delta;
  return [Math.floor(t / 12), (t % 12) + 1];
};
export const diffDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Periodo di budget: dal giorno di stipendio (incluso) al successivo (escluso).
export function period(today, salaryDay) {
  const [y, m, d] = today.split('-').map(Number);
  let sy = y;
  let sm = m;
  if (d < Math.min(salaryDay, daysInMonth(y, m))) [sy, sm] = addMonths(y, m, -1);
  const [ey, em] = addMonths(sy, sm, 1);
  const start = fmt(sy, sm, Math.min(salaryDay, daysInMonth(sy, sm)));
  const end = fmt(ey, em, Math.min(salaryDay, daysInMonth(ey, em)));
  return { start, end, daysLeft: diffDays(today, end), totalDays: diffDays(start, end) };
}

// Quanti accrediti di stipendio cadono in (after, upto].
export function countSalaryDates(after, upto, day) {
  const [ay, am] = after.split('-').map(Number);
  const [uy, um] = upto.split('-').map(Number);
  let n = 0;
  let [y, m] = [ay, am];
  while (y * 12 + m <= uy * 12 + um) {
    const d = fmt(y, m, Math.min(day, daysInMonth(y, m)));
    if (d > after && d <= upto) n++;
    [y, m] = addMonths(y, m, 1);
  }
  return n;
}

// Date degli accrediti di stipendio in (after, upto].
export function salaryDates(after, upto, day) {
  const [ay, am] = after.split('-').map(Number);
  const [uy, um] = upto.split('-').map(Number);
  const out = [];
  let [y, m] = [ay, am];
  while (y * 12 + m <= uy * 12 + um) {
    const d = fmt(y, m, Math.min(day, daysInMonth(y, m)));
    if (d > after && d <= upto) out.push(d);
    [y, m] = addMonths(y, m, 1);
  }
  return out;
}

export const addDaysStr = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);

// Date in (after, upto] in cui cade un pagamento annuale (es. tredicesima: mese 12, giorno 24).
export function yearlyDates(month, day, after, upto) {
  const out = [];
  const y0 = Number(after.slice(0, 4));
  const y1 = Number(upto.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    const d = fmt(y, month, Math.min(day, daysInMonth(y, month)));
    if (d > after && d <= upto) out.push(d);
  }
  return out;
}

// Quante volte cade, tra from e to (entrambi inclusi), un pagamento mensile il giorno `day`.
export function monthlyCount(day, from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  let n = 0;
  let [y, m] = [fy, fm];
  while (y * 12 + m <= ty * 12 + tm) {
    const d = fmt(y, m, Math.min(day, daysInMonth(y, m)));
    if (d >= from && d <= to) n++;
    [y, m] = addMonths(y, m, 1);
  }
  return n;
}

// Prima data, a partire da `from` (incluso), in cui cade quel giorno del mese.
export function nextOccurrence(day, from) {
  const [y, m] = from.split('-').map(Number);
  const d = fmt(y, m, Math.min(day, daysInMonth(y, m)));
  if (d >= from) return d;
  const [ny, nm] = addMonths(y, m, 1);
  return fmt(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

// Data in cui una spesa ricorrente cade dentro [start, end).
export function dueInPeriod(day, start, end) {
  const [sy, sm] = start.split('-').map(Number);
  for (const [y, m] of [[sy, sm], addMonths(sy, sm, 1)]) {
    const d = fmt(y, m, Math.min(day, daysInMonth(y, m)));
    if (d >= start && d < end) return d;
  }
  return end;
}
