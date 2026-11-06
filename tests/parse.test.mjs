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
