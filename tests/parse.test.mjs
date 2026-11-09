import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBankMessage, parseAmount } from '../api/_parse.js';

test('importi in formato italiano', () => {
  assert.equal(parseAmount('Pagamento di 12,60 € presso BAR'), 12.6);
  assert.equal(parseAmount('Addebito EUR 1.234,50'), 1234.5);
  assert.equal(parseAmount('senza importo'), null);
});

test('pagamento con carta: spesa con negozio e categoria', () => {
  const p = parseBankMessage('Pagamento carta di 18,00 € presso CLAUDE.AI SUBSCRIPTION il 06/11.');
  assert.equal(p.type, 'expense');
  assert.equal(p.amount, 18);
  assert.match(p.merchant, /CLAUDE/);
});

test('prelievo: categoria Contanti', () => {
  const p = parseBankMessage('Prelievo di 50,00 € presso ATM Intesa');
  assert.equal(p.type, 'expense');
  assert.equal(p.category, 'Contanti');
});

test('accredito: entrata Extra; stipendio ignorato (è già nelle impostazioni)', () => {
  assert.equal(parseBankMessage('Accredito di 25,00 € a tuo favore').type, 'income');
  assert.equal(parseBankMessage('Accredito stipendio 1.792,26 €').ignore, true);
});

test('operazione fallita: ignorata; la firma legale con “non autorizzata” non la fa scartare', () => {
  assert.equal(parseBankMessage('Pagamento di 20,00 € non andato a buon fine').ignore, true);
  const ok = parseBankMessage('Pagamento carta di 12,60 € presso PORRINI ROBERTO. Cordiali saluti. Se non hai autorizzato l\'operazione contattaci: operazione non autorizzata.');
  assert.equal(ok.type, 'expense');
  assert.equal(ok.amount, 12.6);
});

test('messaggio non riconosciuto o senza importo: errore, non ignorato', () => {
  assert.ok(parseBankMessage('Ciao, novità su Intesa').error);
  assert.ok(parseBankMessage('Pagamento effettuato con carta').error);
  assert.ok(parseBankMessage('').error);
});

import { guessFromText, applyRules } from '../api/_parse.js';

test('regole di categoria: vince il testo più specifico, altrimenti resta la categoria proposta', () => {
  const rules = [{ pattern: 'porrini', category: 'Svago' }, { pattern: 'porrini roberto', category: 'Salute' }];
  assert.equal(applyRules(rules, 'PORRINI ROBERTO, ROSETO', 'Altro'), 'Salute');
  assert.equal(applyRules(rules, 'Porrini srl', 'Altro'), 'Svago');
  assert.equal(applyRules(rules, 'COOP', 'Spesa'), 'Spesa');
  assert.equal(applyRules(rules, '', 'Altro'), 'Altro');
});

test('proposta per un messaggio non riconosciuto: importo, tipo e negozio quando ci sono', () => {
  const g = guessFromText('Hai ricevuto un bonifico di 150,00 € a tuo favore da MARIO ROSSI');
  assert.equal(g.type, 'income');
  assert.equal(g.amount, 150);
  const h = guessFromText('Operazione di 20,00 € presso BAR SPORT il 05/11');
  assert.equal(h.type, 'expense');
  assert.equal(h.merchant, 'BAR SPORT');
});

test('benzina: riconosciuta dal distributore o dalle parole del carburante nella mail', () => {
  assert.equal(parseBankMessage('Pagamento carta di 45,00 € presso ENI STATION ROSETO il 07/11').category, 'Benzina');
  assert.equal(parseBankMessage('Pagamento carta di 30,00 € presso Q8 EASY il 07/11').category, 'Benzina');
  assert.equal(parseBankMessage('Pagamento carta di 52,10 € presso AREA DI SERVIZIO 12 il 07/11. Carburante self service').category, 'Benzina');
  assert.equal(parseBankMessage('Pagamento di 40,00 € presso TAMOIL').category, 'Benzina');
  assert.equal(guessFromText('Operazione di 38,00 € presso IP PETROLI il 05/11').category, 'Benzina');
});

test('benzina: non scambia altri negozi per distributori; autostrada e treno restano Trasporti', () => {
  assert.equal(parseBankMessage('Pagamento carta di 12,00 € presso ESSELUNGA ROSETO il 07/11').category, 'Spesa');
  assert.equal(parseBankMessage('Pagamento carta di 9,00 € presso PASTICCERIA GRIMALDI il 07/11').category, 'Altro');
  assert.equal(parseBankMessage('Pagamento carta di 8,40 € presso AUTOSTRADE PER L ITALIA il 07/11').category, 'Trasporti');
  assert.equal(parseBankMessage('Pagamento carta di 29,90 € presso TRENITALIA il 07/11').category, 'Trasporti');
});

test('negozio con punti nel nome (F.LLI DI FRANCESCO L. &) non viene tagliato', () => {
  const p = parseBankMessage('Gentile cliente, ti informiamo che in data 07.11 è stato richiesto un pagamento di 30,00 euro con la carta 5167_*_*_5019 presso F.LLI DI FRANCESCO L. &, ROSETO DEGLI ABRUZZI Cordiali saluti Intesa Sanpaolo Questo messaggio è stato inviato da un indirizzo email di sola notifica');
  assert.equal(p.type, 'expense');
  assert.equal(p.amount, 30);
  assert.equal(p.merchant, 'F.LLI DI FRANCESCO L. &, ROSETO DEGLI ABRUZZI');
  assert.equal(parseBankMessage('Pagamento carta di 9,00 € presso CLAUDE.AI SUBSCRIPTION il 06/11.').merchant, 'CLAUDE.AI SUBSCRIPTION');
  assert.equal(parseBankMessage('Pagamento di 5,00 € presso BAR SPORT. Saldo disponibile 100,00 €').merchant, 'BAR SPORT');
});

test('carta virtuale: "…alle ore 14:09 da PAYPAL *PLAYSTATION" → negozio PLAYSTATION, categoria Svago', () => {
  const r = parseBankMessage('Gentile cliente,\nhai pagato 79,99 EUR con la carta virtuale *7094 rif. carta *5019 il 11.09 alle ore 14:09 da PAYPAL *PLAYSTATION, .\n\nCordiali saluti\nIntesa Sanpaolo\n\nQuesto messaggio è stato inviato da un indirizzo email di sola notifica ti preghiamo di non rispondere.');
  assert.equal(r.amount, 79.99);
  assert.equal(r.merchant, 'PLAYSTATION');
  assert.equal(r.category, 'Svago');
  const t = parseBankMessage('Gentile cliente, hai pagato 73,80 EUR con la carta virtuale *7094 rif. carta *5019 il 11.09 alle ore 09:36 da TRENITALIA SPA, .');
  assert.equal(t.merchant, 'TRENITALIA SPA');
  assert.equal(t.category, 'Trasporti');
  assert.equal(parseBankMessage('hai pagato 9,99 EUR presso PAYPAL *NETFLIX il 11/09').merchant, 'NETFLIX');
});
