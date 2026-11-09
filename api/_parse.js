// Interpreta il testo di un SMS/avviso bancario (es. Intesa Sanpaolo).
// Il parser è volutamente tollerante: non dipende da un formato esatto.

const INCOME_RE = /accredit|ricevut|a tuo favore|rimbors|storno/i;
const SALARY_RE = /stipendio|emolument|retribuzion/i;
const REFUND_RE = /riaccredit|rimbors|storno/i;
const FAIL_RE = /non andat\w* a buon fine|non (?:è|e'|e) stat\w* (?:autorizzat|eseguit)|rifiutat|negat|respint|declin|non autorizzat|annullat|fallit/i;
const OUTFLOW_RE = /pagament|addebit|prelie|prelev|acquist|pagato|bonifico|spesa|operazione|ricaric|disposizion|carta/i;

const AMOUNT_RES = [
  /(?:€|EUR|euro)\s*(\d{1,3}(?:\.\d{3})*,\d{1,2}|\d+(?:[.,]\d{1,2})?)/i,
  /(\d{1,3}(?:\.\d{3})*,\d{1,2}|\d+(?:[.,]\d{1,2})?)\s*(?:€|EUR|euro)/i,
];

const MERCHANT_RE =
  /(?:presso|c\/o|a favore di|beneficiario|esercente)\s*:?\s+(.+?)(?=\s+(?:il|in data|alle|ore|con|carta|del|tramite)\b|\s+\d{1,2}[\/.]\d{1,2}|;|\.\s*$|\.\s+(?:saldo|disponibil|se|per|grazie|info|cordiali|questo|il presente)\b|$)/i;

// Pagamenti con carta virtuale: "…il 11.09 alle ore 14:09 da PAYPAL *PLAYSTATION, ."
const MERCHANT_DA_RE = /alle ore \d{1,2}[:.]\d{2}\s+da\s+(.+?)(?=\s*,|\s*\.\s*$|\s*\.\s|$)/i;
// Dietro PayPal e simili c'è il vero negozio: "PAYPAL *PLAYSTATION" → "PLAYSTATION"
const cleanMerchant = (m) => String(m || '').replace(/^(?:paypal|pp|sumup|sq|zettle|satispay)\s*\*\s*/i, '').replace(/\s+/g, ' ').trim();
const findMerchant = (text) => cleanMerchant(text.match(MERCHANT_RE)?.[1] || text.match(MERCHANT_DA_RE)?.[1] || '').slice(0, 60);

// Carburante: nome del distributore o parole tipiche, nel negozio o nel testo della mail
const FUEL_RE = /benzin|carburant|gasolio|diesel|\bgpl\b|rifornimento|stazione di servizio|self.?service|\beni\b|enilive|agip|\bq8\b|\besso\b|tamoil|\bip\b|\bshell\b|total ?energies|repsol|\bies\b|\bapi\b|\berg\b|kerotris|italiana petroli/i;

const CATEGORY_RULES = [
  ['Spesa', /supermerc|coop|conad|esselunga|lidl|carrefour|despar|eurospin|md\b|pam\b|\baldi\b|famila|iper/i],
  ['Ristoranti', /ristor|pizzer|trattor|osteria|\bbar\b|caff|mcdonald|burger|sushi|kebab|gelat|pub\b/i],
  ['Benzina', FUEL_RE],
  ['Trasporti', /autostrad|telepass|trenitalia|italo|uber|\batm\b|taxi|parcheggi/i],
  ['Abbonamenti', /netflix|spotify|prime video|disney|apple\.com|itunes|google|dazn|youtube|icloud/i],
  ['Salute', /farmaci|parafarm|medic|clinic|dent|ottic/i],
  ['Svago', /playstation|\bpsn\b|\bsteam|nintendo|xbox|epic games|cinema|teatro|ticketone|concert|bowling|twitch|\bgaming\b/i],
  ['Shopping', /amazon|zalando|zara|h&m|ikea|decathlon|mediaworld|unieuro|paypal/i],
  ['Casa', /enel|hera|iren|\bgas\b|luce|affitto|condomin|bolletta/i],
];

export function parseAmount(text) {
  for (const re of AMOUNT_RES) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1].replace(/\./g, (d, i, s) => (s.includes(',') ? '' : d)).replace(',', '.'));
      if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
    }
  }
  return null;
}

export function guessCategory(merchant) {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(merchant)) return cat;
  return 'Altro';
}

// Categoria di una spesa: dal negozio; se non basta, le parole del carburante nel testo della mail
function categorize(merchant, text) {
  const g = guessCategory(merchant);
  return g === 'Altro' && FUEL_RE.test(text) ? 'Benzina' : g;
}

// → { ignore: true, reason } | { error } | { type, amount, merchant, category }
export function parseBankMessage(raw) {
  // Nelle e-mail conta solo il corpo: firma e avvertenze legali ("non autorizzata…") vanno scartate.
  const text = String(raw || '').split(/cordiali saluti|questo messaggio è stato inviato|il presente messaggio/i)[0].replace(/\s+/g, ' ').trim();
  if (!text) return { error: 'Testo vuoto' };

  if (SALARY_RE.test(text)) return { ignore: true, reason: 'Stipendio: già contato dalle impostazioni' };

  // Pagamenti/prelievi falliti: Intesa manda l'SMS, ma i soldi non si sono mossi.
  if (!REFUND_RE.test(text) && FAIL_RE.test(text)) {
    return { ignore: true, reason: 'Operazione non andata a buon fine' };
  }

  const income = INCOME_RE.test(text);
  if (!income && !OUTFLOW_RE.test(text)) return { error: 'Messaggio non riconosciuto' };

  const amount = parseAmount(text);
  if (!amount) return { error: 'Importo non trovato' };

  const merchant = findMerchant(text);
  const type = income ? 'income' : 'expense';
  return {
    type,
    amount,
    merchant,
    category: type === 'income' ? 'Extra' : /prelie|prelev/i.test(text) ? 'Contanti' : categorize(merchant, text),
  };
}

// Proposta per un messaggio che il parser non ha registrato da solo (serve a precompilare il modulo)
export function guessFromText(raw) {
  const text = String(raw || '').split(/cordiali saluti|questo messaggio è stato inviato|il presente messaggio/i)[0].replace(/\s+/g, ' ').trim();
  const type = INCOME_RE.test(text) && !SALARY_RE.test(text) ? 'income' : 'expense';
  const merchant = findMerchant(text);
  return {
    type,
    amount: parseAmount(text),
    merchant,
    category: type === 'income' ? 'Extra' : /prelie|prelev/i.test(text) ? 'Contanti' : categorize(merchant, text),
  };
}

// Regole dell'utente: se il negozio contiene il testo di una regola, vince la sua categoria.
export function applyRules(rules, merchant, fallback) {
  const m = String(merchant || '').toLowerCase();
  if (!m) return fallback;
  const hit = rules.filter((r) => m.includes(r.pattern)).sort((a, b) => b.pattern.length - a.pattern.length)[0];
  return hit ? hit.category : fallback;
}
