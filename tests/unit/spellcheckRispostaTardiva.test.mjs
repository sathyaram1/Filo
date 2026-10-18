// #1097.5 — la risposta del correttore arrivata mentre l'utente scriveva non si butta: i segni passano sul testo di
// adesso. E uno scan non riparte se sono cambiati solo spazi e punteggiatura.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.SN_MSG ??= { MSG: {} };
globalThis.SN_CONST ??= { ACTIONS: {}, STORAGE_KEYS: {} };
require(join(ROOT, 'src', 'content', 'spellcheck.js'));
const { segniDellaRisposta, soloSpaziOPunteggiatura } = globalThis.SN_SPELLCHECK;

const INVIATO = 'ieri sonno andato al mare con Luca';
const RISPOSTA = JSON.stringify({
  annotated: 'ieri **sonno** andato al mare con Luca',
  issues: [{ type: 'semantic', explanation: 'forse «sono»', correction: 'sono' }],
});
const segnate = (testo, r) => r.issues.map((i) => testo.slice(i.start, i.end));

test('scritto dopo il segno mentre la risposta viaggiava: il segno resta sulla sua parola', () => {
  const adesso = `${INVIATO} e Anna`;
  const r = segniDellaRisposta(RISPOSTA, INVIATO, adesso);
  assert.deepEqual(segnate(adesso, r), ['sonno']);
  assert.equal(r.perse, false);
  assert.equal(r.issues[0].correction, 'sono');
});

test('scritto prima del segno: il segno scorre con la sua parola', () => {
  const adesso = `Sabato scorso, ${INVIATO}`;
  const r = segniDellaRisposta(RISPOSTA, INVIATO, adesso);
  assert.deepEqual(segnate(adesso, r), ['sonno']);
  assert.equal(r.issues[0].start, INVIATO.indexOf('sonno') + 'Sabato scorso, '.length);
});

test('la parola segnata è stata cambiata nel frattempo: quel segno non torna, e lo scan dopo si rifà', () => {
  const adesso = INVIATO.replace('sonno', 'sono');
  const r = segniDellaRisposta(RISPOSTA, INVIATO, adesso);
  assert.deepEqual(r.issues, []);
  assert.equal(r.perse, true);
});

test('testo invariato: la risposta vale così com\'è', () => {
  const r = segniDellaRisposta(RISPOSTA, INVIATO, INVIATO);
  assert.deepEqual(segnate(INVIATO, r), ['sonno']);
  assert.equal(r.perse, false);
});

test('solo spazi o punteggiatura cambiati: niente scan nuovo; una parola cambiata, fusa o divisa sì', () => {
  assert.equal(soloSpaziOPunteggiatura(INVIATO, `${INVIATO}.`), true);
  assert.equal(soloSpaziOPunteggiatura(INVIATO, INVIATO.replace('andato', 'andato,')), true);
  assert.equal(soloSpaziOPunteggiatura(INVIATO, INVIATO.replace(' al ', '  al ')), true);
  assert.equal(soloSpaziOPunteggiatura("l'albero è alto", 'l’albero è alto!'), true);
  assert.equal(soloSpaziOPunteggiatura(INVIATO, INVIATO.replace('mare', 'mari')), false);
  assert.equal(soloSpaziOPunteggiatura(INVIATO, INVIATO.replace('al mare', 'almare')), false);
  assert.equal(soloSpaziOPunteggiatura(INVIATO, INVIATO), false);
  // Apostrofo e trattino cambiano la parola (#1097 giro 1): «un'amico» è l'errore da trovare.
  assert.equal(soloSpaziOPunteggiatura('ho visto un amico ieri', "ho visto un'amico ieri"), false);
  assert.equal(soloSpaziOPunteggiatura("dammene un po' di più", 'dammene un po di più'), false);
  assert.equal(soloSpaziOPunteggiatura('e-mail inviata ieri', 'e mail inviata ieri'), false);
  // Mai controllato (o un segno perso che chiede di rifarlo): lo scan parte.
  assert.equal(soloSpaziOPunteggiatura('', INVIATO), false);
});
