// I marker [[calc: ...]] che «Spiega» e «Approfondisci» fanno scrivere al
// modello al posto dei conti, e come il risultato viene scritto (#724).
//
// La conversione di una valuta è un prezzo: chi seleziona «3000 rupie» vuole
// leggere «circa 27,45 €», non «27,4473924977 €». Il modello il conto non lo
// rifà — il numero lo scrive il codice — quindi la regola sta qui.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'calcMarkers.js'));
const { resolveCalcMarkers: risolvi } = globalThis.SN_CALC;

test('la conversione di «3000 rupie» si legge come un prezzo', () => {
  assert.equal(risolvi('3000 rupie ([[calc: 3000/109.3]] €)'), '3000 rupie (27,45 €)');
});

test('due decimali comunque sia scritta la valuta accanto al risultato', () => {
  assert.equal(risolvi('[[calc: 50/1.08]] €'), '46,30 €');
  assert.equal(risolvi('[[calc: 50/1.08]] EUR'), '46,30 EUR');
  assert.equal(risolvi('[[calc: 50/1.08]] euro'), '46,30 euro');
  assert.equal(risolvi('circa €[[calc: 50/1.08]]'), 'circa €46,30');
  assert.equal(risolvi('[[calc: 3000*1.08]] $'), '3.240,00 $');
});

test('la formattazione fra il numero e la valuta non riporta le dodici cifre', () => {
  // Il modello mette in risalto il numero e lascia l'euro fuori dal risalto:
  // nella resa il risalto sparisce e resta un prezzo da leggere.
  assert.equal(risolvi('circa **[[calc: 50/1.08]]** €'), 'circa **46,30** €');
  assert.equal(risolvi('circa *[[calc: 50/1.08]]* euro'), 'circa *46,30* euro');
  assert.equal(risolvi('circa _[[calc: 50/1.08]]_ EUR'), 'circa _46,30_ EUR');
  assert.equal(risolvi('50 $ ([[calc: 50/1.08]]) €'), '50 $ (46,30) €');
  // Stessa causa dall'altro lato: la valuta scritta prima del numero.
  assert.equal(risolvi('prezzo: EUR [[calc: 50/1.08]]'), 'prezzo: EUR 46,30');
  assert.equal(risolvi('prezzo: euro **[[calc: 50/1.08]]**'), 'prezzo: euro **46,30**');
  // In streaming il numero aspetta anche quando il risalto arriva per primo.
  assert.equal(risolvi('circa **[[calc: 50/1.08]]**', { streaming: true }), 'circa **…**');
});

test('un asterisco a capo è un elenco, non il grassetto del numero', () => {
  // Altrimenti la voce dopo, se comincia con una valuta, arrotonderebbe una
  // misura che non è un prezzo.
  assert.equal(risolvi('Superficie [[calc: 4.4*5.1]]\n* USD 50'), 'Superficie 22,44\n* USD 50');
  assert.equal(risolvi('Distanza [[calc: 3*1.609]] km'), 'Distanza 4,827 km');
});

test('un importo sotto il centesimo non viene azzerato', () => {
  // «0,00 €» sarebbe una bugia: l'importo c'è, sono le cifre a dover crescere.
  const out = risolvi('[[calc: 0.001/1.08]] €');
  assert.ok(!out.startsWith('0,00 '), `importo azzerato: ${out}`);
  assert.ok(parseFloat(out.replace(',', '.')) > 0);
});

test('senza valuta accanto il risultato resta il numero di prima', () => {
  assert.equal(risolvi('[[calc: 33*7+742/7+9]]'), '346');
  assert.equal(risolvi('area [[calc: 4.4*5.1]] m²'), 'area 22,44 m²');
  assert.equal(risolvi('[[calc: 3*1.609]] km'), '4,827 km');
  // Un quoziente periodico non è un prezzo: le cifre restano.
  assert.ok(risolvi('[[calc: 1/3]]').startsWith('0,3333'));
});

test('i numeri grandi si separano, gli anni no', () => {
  assert.equal(risolvi('[[calc: 347*55]]'), '19.085');
  assert.equal(risolvi('[[calc: 12345678/1.08]] EUR'), '11.431.183,33 EUR');
  // Quattro cifre senza valuta accanto è quasi sempre un anno: «2.026» no.
  assert.equal(risolvi('[[calc: 2000+26]]'), '2026');
});

test('in streaming il numero aspetta la valuta invece di sfarfallare', () => {
  // Il marker chiude un pezzo prima del «€»: se il risultato uscisse subito,
  // «27,4473924977» diventerebbe «27,45 €» sotto gli occhi di chi legge.
  assert.equal(risolvi('costa [[calc: 3000/109.3]]', { streaming: true }), 'costa …');
  assert.equal(risolvi('costa [[calc: 3000/109.3]] €', { streaming: true }), 'costa 27,45 €');
  // A risposta finita il numero c'è sempre, valuta o no.
  assert.equal(risolvi('costa [[calc: 3000/109.3]]'), 'costa 27,4473924977');
});

test('un marker che non è un conto resta visibile e non rompe il testo', () => {
  assert.equal(risolvi('boh [[calc: nonsenso]] x'), 'boh [[calc: nonsenso]] x');
  assert.equal(risolvi(''), '');
  assert.equal(risolvi('   '), '   ');
  assert.equal(risolvi('[[calc: 1/0]] €'), '[[calc: 1/0]] €');
  assert.equal(risolvi('🙂 [[calc: 2+2]] €'), '🙂 4,00 €');
});

// Secondo giro di verifica del #724 — il vicinato del numero non basta: basta
// una parola fra il risultato e l'euro («circa 27,45 in euro») e tornavano le
// dodici cifre della segnalazione. A dire che quel numero è un prezzo dev'essere
// chi ORDINA il conto, non le parole che gli finiscono intorno.
test('l\'unità dichiarata nel marker vale comunque sia scritta la frase', () => {
  assert.equal(risolvi('sono circa [[calc: 3000/109.3 | eur]] in euro'), 'sono circa 27,45 in euro');
  assert.equal(risolvi('sono circa [[calc: 3000/109.3 | eur]], cioè poco'), 'sono circa 27,45, cioè poco');
  assert.equal(risolvi('| INR | [[calc: 3000/109.3|eur]] | € |'), '| INR | 27,45 | € |');
  assert.equal(risolvi('[[calc: 3000/109.3 | EUR]]'), '27,45');
  assert.equal(risolvi('[[calc: 1500000/109.3 | euro]]'), '13.723,70');
});

test('senza unità dichiarata il vicinato resta un ripiego, non sparisce', () => {
  assert.equal(risolvi('[[calc: 50/1.08]] €'), '46,30 €');
  assert.equal(risolvi('[[calc: 1/3]]').startsWith('0,3333'), true);
});

test('un\'unità che Filo non conosce non toglie le cifre né rompe il conto', () => {
  assert.equal(risolvi('[[calc: 3*1.609 | km]] km'), '4,827 km');
  assert.equal(risolvi('[[calc: nonsenso | eur]]'), '[[calc: nonsenso | eur]]');
});

test('col prezzo dichiarato in streaming non c\'è niente da aspettare', () => {
  assert.equal(risolvi('costa [[calc: 3000/109.3 | eur]]', { streaming: true }), 'costa 27,45');
});
