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
  /(?:presso|c\/o|a favore di|beneficiario|esercente)\s*:?\s+(.+?)(?=\s+(?:il|in data|alle|ore|con|carta|del|tramite)\b|\s+\d{1,2}[\/.]\d{1,2}|[.;\n]|$)/i;

const CATEGORY_RULES = [
  ['Spesa', /supermerc|coop|conad|esselunga|lidl|carrefour|despar|eurospin|md\b|pam\b|aldi|famila|iper/i],
  ['Ristoranti', /ristor|pizzer|trattor|osteria|\bbar\b|caff|mcdonald|burger|sushi|kebab|gelat|pub\b/i],
  ['Trasporti', /\beni\b|q8|esso|tamoil|\bip\b|autostrad|telepass|trenitalia|italo|uber|\batm\b|taxi|parcheggi|benzin|carburant/i],
  ['Abbonamenti', /netflix|spotify|prime video|disney|apple\.com|itunes|google|dazn|youtube|icloud/i],
  ['Salute', /farmaci|parafarm|medic|clinic|dent|ottic/i],
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

// → { ignore: true, reason } | { error } | { type, amount, merchant, category }
export function parseBankMessage(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
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

  const merchant = (text.match(MERCHANT_RE)?.[1] || '').trim().slice(0, 60);
  const type = income ? 'income' : 'expense';
  return {
    type,
    amount,
    merchant,
    category: type === 'income' ? 'Extra' : /prelie|prelev/i.test(text) ? 'Contanti' : guessCategory(merchant),
  };
}
