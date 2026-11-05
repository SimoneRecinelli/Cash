import { neon } from '@neondatabase/serverless';
import { timingSafeEqual } from 'node:crypto';

const TZ = 'Europe/Rome';

let _sql;
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
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

function authorized(req) {
  const key = process.env.APP_KEY || '';
  const got = String(req.headers['x-app-key'] || '');
  const a = Buffer.from(got);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function handler(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!process.env.APP_KEY) {
        return res.status(500).json({ error: 'APP_KEY non configurata su Vercel' });
      }
      if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida' });
      await init();
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
