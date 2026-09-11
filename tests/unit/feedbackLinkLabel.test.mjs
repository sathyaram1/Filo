// Sentinella sulla scritta con cui si mostra un indirizzo che arriva da fuori
// (SN_FEEDBACK.linkLabel) — #582, giro 3.
//
// Il caso che l'ha fatta nascere. Nell'elenco dei feedback, in cima a ogni
// scheda, c'è l'indirizzo della pagina da cui la segnalazione è partita, ed è
// un collegamento: chi fa triage lo apre, è il posto dove il problema è
// successo. Quell'indirizzo però non lo sceglie Filo — sta dentro la
// segnalazione, e una segnalazione la manda chiunque, anche senza account e
// senza avere Filo installato. La scritta erano i primi 80 caratteri
// dell'indirizzo, tagliati senza nemmeno un puntino: chi lo costruiva apposta
// sceglieva cosa cadeva dentro quegli 80 caratteri, e
//   https://filo.app/guida/…-2026a@sito-di-un-estraneo.invalid/accedi
// si leggeva «https://filo.app/guida/…-2026» e portava dall'estraneo. Misurato:
// la scheda si apriva e la navigazione partiva davvero.
//
// Le tre regole che questo file tiene ferme:
//  1. la parte prima della chiocciola non si mostra mai (è lì solo per mentire);
//  2. l'host non si taglia mai dalla coda — la coda è il posto vero. Se è lui a
//     non entrare, si taglia da davanti;
//  3. un indirizzo tagliato lo dice.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import '../../src/shared/feedback.js';

const FB = globalThis.SN_FEEDBACK;
const TAGLIO = '…';

test('SN_FEEDBACK espone linkLabel e il suo tetto', () => {
  assert.equal(typeof FB.linkLabel, 'function');
  assert.equal(typeof FB.LINK_LABEL_MAX, 'number');
  assert.ok(FB.LINK_LABEL_MAX >= 40);
});

test('un indirizzo corto si legge tutto, senza lo schema davanti', () => {
  assert.equal(FB.linkLabel('https://esempio.it/pagina?x=1#in-fondo'), 'esempio.it/pagina?x=1#in-fondo');
  assert.equal(FB.linkLabel('http://esempio.it/'), 'esempio.it/');
  // La porta fa parte di dove si va, quindi si vede.
  assert.equal(FB.linkLabel('https://esempio.it:8443/x'), 'esempio.it:8443/x');
});

test('il posto vero si legge anche quando chi manda ha messo un’esca davanti alla chiocciola', () => {
  // Tutto quello che sta prima della chiocciola non è il sito: sono
  // credenziali, e qui servono solo a riempire gli 80 caratteri che si leggono.
  // Con la scritta di prima si leggeva
  //   https://filo.app-aggiornamento-obbligatorio-per-i-tester-di-settembre-2026-okay@
  // e si finiva dall'estraneo.
  const esca = 'https://filo.app-aggiornamento-obbligatorio-per-i-tester-di-settembre-2026-okay@sito-di-un-estraneo.invalid/accedi';
  const scritta = FB.linkLabel(esca);
  assert.ok(scritta.startsWith('sito-di-un-estraneo.invalid'), `la scritta non nomina il posto vero: ${scritta}`);
  assert.ok(!scritta.includes('filo.app'), `la scritta mostra ancora l'esca: ${scritta}`);
});

test('il posto vero si legge anche quando l’esca è fatta di sottodomini', () => {
  // La stessa bugia senza chiocciola, e più credibile: il sito è davvero quello
  // scritto in fondo, ma i primi 80 caratteri li riempiono i sottodomini. Con
  // la scritta di prima si leggeva
  //   https://filo.app.guida.aggiornamento-obbligatorio.per-i-tester.settembre-2026.si
  // e il posto vero non compariva affatto.
  const esca = 'https://filo.app.guida.aggiornamento-obbligatorio.per-i-tester.settembre-2026.sito-di-un-estraneo.invalid/accedi';
  const scritta = FB.linkLabel(esca);
  assert.ok(scritta.endsWith('sito-di-un-estraneo.invalid'), `la scritta non finisce sul posto vero: ${scritta}`);
  assert.ok(scritta.startsWith(TAGLIO), `un sito tagliato deve dirlo: ${scritta}`);
});

test('quello che si taglia è la coda dell’indirizzo, mai la coda del sito', () => {
  const lungo = `https://esempio.it/${'a'.repeat(500)}`;
  const scritta = FB.linkLabel(lungo);
  assert.ok(scritta.startsWith('esempio.it/'), scritta);
  assert.ok(scritta.endsWith(TAGLIO), `un indirizzo tagliato deve dirlo: ${scritta}`);
  assert.equal(scritta.length, FB.LINK_LABEL_MAX);
});

test('se è il sito a non entrare, si taglia da DAVANTI: la fine è il posto vero', () => {
  // La stessa bugia un piano più sotto: un sito che comincia come Filo e
  // finisce altrove. Tagliando dalla coda si sarebbe letto «filo.app.…».
  const sottodomini = `https://filo.app.${'aggiornamento.'.repeat(12)}sito-di-un-estraneo.invalid/accedi`;
  const scritta = FB.linkLabel(sottodomini);
  assert.ok(scritta.startsWith(TAGLIO), `un sito tagliato deve dirlo: ${scritta}`);
  assert.ok(scritta.endsWith('sito-di-un-estraneo.invalid'), `la fine non è il posto vero: ${scritta}`);
  assert.equal(scritta.length, FB.LINK_LABEL_MAX);
});

test('mai più lunga del tetto, qualunque cosa arrivi', () => {
  const casi = [
    'https://esempio.it/',
    `https://${'x'.repeat(300)}.it/${'y'.repeat(300)}`,
    `https://utente:parola@${'z'.repeat(70)}.it/${'k'.repeat(200)}`,
    `https://esempio.it/?${'q=1&'.repeat(200)}`,
    `https://esempio.it/#${'f'.repeat(300)}`,
  ];
  for (const c of casi) {
    const scritta = FB.linkLabel(c);
    assert.ok(scritta.length <= FB.LINK_LABEL_MAX, `troppo lunga (${scritta.length}): ${c}`);
    assert.ok(scritta.length > 0, `scritta vuota per ${c}`);
  }
});

test('un tetto passato a mano vale, uno storto no (si ricade sul tetto di serie)', () => {
  assert.equal(FB.linkLabel(`https://esempio.it/${'a'.repeat(100)}`, 20).length, 20);
  for (const storto of [0, -5, 3, NaN, Infinity, 'venti', null, undefined]) {
    const scritta = FB.linkLabel(`https://esempio.it/${'a'.repeat(300)}`, storto);
    assert.equal(scritta.length, FB.LINK_LABEL_MAX, `tetto storto accettato: ${String(storto)}`);
  }
});

test('quello che non è un indirizzo torna vuoto, invece di inventarsi una scritta', () => {
  for (const niente of ['', null, undefined, 'non un indirizzo', 'esempio.it/senza-schema', {}, 42]) {
    assert.equal(FB.linkLabel(niente), '', `ha inventato una scritta per ${String(niente)}`);
  }
});

test('un indirizzo che non porta da nessuna parte resta riconoscibile', () => {
  // safeHref lascia passare solo http/https, ma linkLabel non deve rompersi su
  // quello che le arriva: qui interessa che non menta, non che filtri.
  assert.equal(FB.linkLabel('javascript:alert(1)'), '');
  assert.equal(FB.linkLabel('data:text/html,<script>'), '');
});
