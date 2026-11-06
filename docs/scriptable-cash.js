// Widget "Cash" per l'app Scriptable (iPhone). Mostra quanto ti resta da spendere.
// La chiave del widget (WIDGET_KEY di Vercel) non è scritta qui: Scriptable te la chiede
// la prima volta e la conserva nel Portachiavi.
const URL_BASE = 'https://cash-six-psi.vercel.app';
const KEY_NAME = 'cash_widget_key';

async function getKey() {
  if (Keychain.contains(KEY_NAME)) return Keychain.get(KEY_NAME);
  const a = new Alert();
  a.title = 'Chiave del widget Cash';
  a.message = 'Incolla il valore di WIDGET_KEY';
  a.addSecureTextField('WIDGET_KEY');
  a.addAction('Salva');
  await a.present();
  const k = a.textFieldValue(0).trim();
  Keychain.set(KEY_NAME, k);
  return k;
}

async function load() {
  const req = new Request(URL_BASE + '/api/widget');
  req.headers = { 'x-widget-key': await getKey() };
  const j = await req.loadJSON();
  if (req.response.statusCode !== 200) {
    if (req.response.statusCode === 401) Keychain.remove(KEY_NAME); // chiave errata: la richiede la prossima volta
    throw new Error('Errore ' + req.response.statusCode);
  }
  return j;
}

const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Math.round(n));
const w = new ListWidget();
w.backgroundColor = Color.dynamic(new Color('#f5f5f0'), new Color('#0c1210'));
w.setPadding(14, 16, 14, 16);

try {
  const d = await load();
  const t1 = w.addText('Ti restano');
  t1.font = Font.mediumSystemFont(12);
  t1.textOpacity = 0.6;
  const big = w.addText(eur(d.remaining));
  big.font = Font.boldRoundedSystemFont(32);
  big.textColor = d.over ? new Color('#b91c1c') : Color.dynamic(new Color('#0f766e'), new Color('#2dd4bf'));
  big.minimumScaleFactor = 0.6;
  w.addSpacer(4);
  const sub = w.addText(d.over ? 'Budget superato' : `${eur(d.dinners)} cene · ${eur(d.beyond)} oltre`);
  sub.font = Font.systemFont(12);
  const days = w.addText(`${d.daysLeft} giorni allo stipendio`);
  days.font = Font.systemFont(11);
  days.textOpacity = 0.6;
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
} catch (e) {
  const t = w.addText('Cash non raggiungibile');
  t.font = Font.mediumSystemFont(13);
  const s = w.addText(String(e.message || e));
  s.font = Font.systemFont(11);
  s.textOpacity = 0.6;
}

if (config.runsInWidget) Script.setWidget(w);
else await w.presentSmall();
Script.complete();
