# Spese

App per tenere traccia di spese ed entrate e sapere quanto puoi ancora spendere
fino al prossimo stipendio. PWA (si aggiunge alla Home dell'iPhone), API serverless
su Vercel, database Postgres su Neon.

## Come calcola

Il periodo va dal giorno di stipendio al giorno di stipendio successivo.

    restano = stipendio + altre entrate − da mettere da parte − spese − ricorrenti non ancora viste
    al giorno = restano ÷ giorni mancanti al prossimo stipendio

Lo stipendio è contato in automatico: non registrarlo come entrata.

**Obiettivi sul conto.** In Impostazioni inserisci il saldo attuale; poi, dalla sezione
"Obiettivi sul conto", aggiungi una o più coppie cifra + data. Con più obiettivi il budget
segue quello che stringe di più. L'app stima il saldo (saldo inserito + movimenti registrati +
stipendi arrivati) e calcola quanto mettere da parte a ogni stipendio per arrivarci;
quella cifra viene tolta dal budget. Spendere non la fa cambiare. Se il saldo stimato
si scosta da quello vero, correggilo da Impostazioni (o da "Aggiorna saldo").

**Come funziona con l'obiettivo.** Da qui alla data entrano gli stipendi che mancano più le
mensilità aggiuntive (tredicesima, quattordicesima…). Tolto quello che serve per arrivare
alla cifra e le spese ricorrenti, quanto avanza è ciò che puoi spendere in tutto. Il budget
del periodo ne prende la parte proporzionale ai giorni e resta fisso: spendere lo riduce
esattamente di quanto spendi. Si ricalcola a ogni nuovo stipendio e quando correggi il saldo.
Se la cifra non è raggiungibile, l'app lo dice invece di mostrare numeri senza senso.

**Mensilità aggiuntive.** Importo netto previsto e data (si ripete ogni anno). Contano come
entrata solo quando la data è arrivata. Per la tredicesima un'ipotesi ragionevole è circa il
90% dello stipendio netto mensile, perché non ha le detrazioni mensili.

**Spese ricorrenti.** Affitto, abbonamenti, rate: indica nome, importo e giorno del mese.
Finché non arriva un SMS che le conferma (stessa parola chiave e importo simile) l'importo
è *riservato* nel budget; quando l'SMS arriva diventa "Verificata" e non viene contato due
volte. Se un pagamento non genera SMS, aprila e tocca "Segna come pagata".
Gli SMS di operazioni non andate a buon fine vengono ignorati.

## Messa online

1. **Neon**: crea un progetto e copia la connection string (Connect → pooled).
   Le tabelle vengono create da sole alla prima richiesta.
2. **Vercel**: dalla cartella del progetto lancia `npx vercel`, poi imposta le variabili
   d'ambiente (Project → Settings → Environment Variables):
   - `DATABASE_URL` = la connection string di Neon
   - `APP_KEY` = una chiave lunga a tua scelta (serve per entrare nell'app)
3. Rilancia `npx vercel --prod` (le variabili valgono dal deploy successivo).
4. **iPhone**: apri l'URL in Safari → Condividi → Aggiungi a Home. Al primo avvio inserisci `APP_KEY`.

## Import automatico dagli avvisi di Intesa

L'iPhone non permette di leggere le notifiche push di un'altra app, ma gli avvisi
SMS (o email) sì. Nella banca online di Intesa vai su **Il mio profilo → Gestione
Notifiche**, scegli il canale **SMS** (serve il cellulare certificato e My Key
attivo) e, nella sezione **Carte**, gli avvisi sui pagamenti. In alternativa il
canale **email**, che è gratuito: in Comandi usa l'automazione "E-mail" invece di
"Messaggio". Poi crea l'automazione:

1. App **Comandi** → Automazione → **+** → **Messaggio**.
2. Mittente: quello degli SMS di Intesa. Il messaggio contiene: una parola ricorrente
   (es. "pagamento"). Imposta **Esegui immediatamente** e disattiva "Avvisa quando viene eseguita".
3. Azioni:
   - **Ottieni contenuto URL** → `https://TUO-PROGETTO.vercel.app/api/ingest`
   - Metodo **POST**, intestazioni: `x-app-key` = la tua `APP_KEY`
   - Corpo richiesta **JSON**, campo `text` = variabile **Input comando** (il testo del messaggio)

Il server riconosce spesa/entrata, importo ed esercente, assegna una categoria e
ignora gli accrediti di stipendio (già contati dalle impostazioni). Le categorie
si possono sempre correggere eliminando la voce e reinserendola.

## Sviluppo locale

    npm install
    cp .env.example .env   # compila i valori
    npx vercel dev


## Sicurezza

- **Accesso**: chiave `APP_KEY` + codice a 6 cifre (TOTP) se è impostata `TOTP_SECRET` su Vercel. Il login (`/api/login`) restituisce un token di sessione firmato valido 14 giorni; l'app salva solo quello, mai la chiave. Cambiare `APP_KEY` o `TOTP_SECRET` invalida tutte le sessioni.
- **Ingest**: `/api/ingest` accetta solo `INGEST_KEY` (se impostata), che non apre nient'altro. Va messa nelle Script Properties di Apps Script al posto di `APP_KEY`.
- **Blocco**: dopo 8 tentativi sbagliati da uno stesso IP, 15 minuti di blocco (HTTP 429).
- **Header**: CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy in `vercel.json`.
- Variabili Vercel: `DATABASE_URL`, `APP_KEY`, `INGEST_KEY`, `TOTP_SECRET`.

## Funzioni

- **Obiettivi e budget**: più obiettivi sul conto, budget del periodo guidato da quello che stringe di più; margine di sicurezza e quota mensile di spese abituali (cene) fuori dal budget libero.
- **Ricorrenti**: giorno fisso oppure variabile (una volta al mese, senza data prevista: mai "in ritardo"); riservate nel budget finché una mail della banca non le conferma. "Già nel saldo" registra un pagamento senza detrarlo di nuovo.
- **Mail della banca** (Apps Script → `/api/ingest`): quello che il parser non capisce finisce in "Da controllare" (Movimenti) e lo registri o scarti a mano. Stipendi e operazioni fallite sono ignorati.
- **Movimenti**: tocca per modificare o eliminare (con Annulla). "Ricorda questa categoria" crea una regola negozio → categoria, applicata alle mail successive.
- **Controllo saldo**: confronta il saldo reale con la stima, registra lo scostamento e allinea. Home lo ricorda dopo 7 giorni.
- **Percorso del saldo** verso gli obiettivi e **mesi chiusi** (variazione del saldo da stipendio a stipendio), da una fotografia giornaliera del saldo.
- **Widget iPhone**: `/api/widget` (sola lettura, header `x-widget-key` = `WIDGET_KEY`). Script per Scriptable in `docs/scriptable-cash.js`.

- **Desideri**: lista di cose da comprare con link (Amazon, Back Market…), prezzo, rate e priorità (alta/media/bassa). Il calendario (`public/sim-core.js`, la stessa logica della pagina Simula) assegna a ogni desiderio, in ordine di priorità, la prima data in cui regge insieme ai precedenti. Da qui si apre Simula precompilato, si segna come comprato (con registrazione della spesa o delle rate) o si modifica.
- **Swipe** sinistra/destra tra le pagine.

## Test

`npm install && npm test` — 73 test (date, motore del budget con casi calcolati a mano, parser, autenticazione, ingest). Il calcolo sta in `api/_calc.js`, senza database né orologio.
