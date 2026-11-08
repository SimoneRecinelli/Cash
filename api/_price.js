// Lettura del prezzo da una pagina di negozio (Amazon, Back Market, …). Best effort: i negozi possono bloccare i robot,
// e in quel caso il prezzo resta "non leggibile" e vale quello che hai scritto tu.

export function parsePrice(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/&nbsp;| |€|EUR|\s/gi, '').replace(/[^0-9.,]/g, '');
  if (!s) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc >= 0) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  else if (ld >= 0 && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
}

const BLOCKED = /captcha|robot check|api-services-support@amazon|are you a human|access denied|verify you are human|enable javascript and cookies/i;

export function extractPrice(html) {
  if (typeof html !== 'string' || !html) return { status: 'empty' };
  const head = html.slice(0, 200000);
  // 1. JSON-LD (schema.org Product/Offer)
  for (const m of head.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const found = [];
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(walk);
        for (const k of ['price', 'lowPrice']) if (o[k] !== undefined && (!o.priceCurrency || /EUR/i.test(o.priceCurrency))) found.push(o[k]);
        Object.values(o).forEach(walk);
      };
      walk(JSON.parse(m[1]));
      for (const f of found) { const p = parsePrice(f); if (p) return { status: 'ok', price: p }; }
    } catch { /* JSON-LD non valido: provo gli altri metodi */ }
  }
  // 2. Meta tag
  for (const re of [/<meta[^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount)["']/i]) {
    const m = head.match(re); const p = m && parsePrice(m[1]); if (p) return { status: 'ok', price: p };
  }
  // 3. Amazon
  for (const re of [/class=["'][^"']*a-price[^"']*["'][^>]*>\s*<span[^>]*class=["']a-offscreen["'][^>]*>([^<]+)</i,
    /id=["']priceblock_(?:ourprice|dealprice)["'][^>]*>([^<]+)</i, /"priceAmount"\s*:\s*([0-9.]+)/i]) {
    const m = head.match(re); const p = m && parsePrice(m[1]); if (p) return { status: 'ok', price: p };
  }
  return { status: BLOCKED.test(head) ? 'blocked' : 'noprice' };
}

// Solo siti pubblici: niente indirizzi IP, localhost o nomi interni (il link lo scrivi tu, ma meglio non fidarsi)
export function safeToFetch(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const h = u.hostname.toLowerCase();
    if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(h)) return false;
    return true;
  } catch { return false; }
}

export async function fetchPrice(url, fetchImpl = fetch) {
  if (!safeToFetch(url)) return { status: 'invalid' };
  try {
    const r = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
      headers: {
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'it-IT,it;q=0.9',
      },
    });
    if (r.url && !safeToFetch(r.url)) return { status: 'invalid' };
    const html = await r.text();
    if (r.status >= 400) return { status: r.status === 404 || r.status === 410 ? 'gone' : 'blocked' };
    return extractPrice(html);
  } catch {
    return { status: 'error' };
  }
}
