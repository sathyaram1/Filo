// #1403.27 — una password con lo spazio dentro, scritta fra virgolette, non arriva al modello nemmeno a metà: le
// virgolette dicono dove finisce. Il pavimento (cancello dei modelli) e il correttore la tolgono intera.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../src/shared/pavimento.js');
const X = globalThis.SN_URL_EXFIL;
const C = require('../../src/main/services/correttoreRiservati.js');
const S = P.SEGNAPOSTO;

const FRASI = [
  ['la password è «Mela! Verde77»', `la password è «${S}»`],
  ['la password è « Mela! Verde77 »', `la password è « ${S} »`],
  ['Password: "Mela! Verde77"', `Password: "${S}"`],
  ['la password è “Mela! Verde77”, ok?', `la password è “${S}”, ok?`],
  ['Le mot de passe est « Mela! Verde77 »', `Le mot de passe est « ${S} »`],
  ['pw «Mela! Verde77»', `pw «${S}»`],
  ['mi mandi la password?\n«Mela! Verde77»', `mi mandi la password?\n«${S}»`],
  ['la password è «Mela! Verde77. Gialla9»', `la password è «${S}»`],
];

test('verso il modello la password fra virgolette diventa un segnaposto solo, intera', () => {
  for (const [frase, atteso] of FRASI) assert.equal(P.oscura(frase), atteso, frase);
  const msg = P.oscuraTutto({ messages: [{ role: 'user', content: 'ciao, la password è «Mela! Verde77»' }] });
  assert.equal(msg.messages[0].content, `ciao, la password è «${S}»`);
});

test('il correttore la toglie intera allo stesso modo', () => {
  for (const [frase, atteso] of FRASI) assert.equal(C.oscura(frase), atteso, frase);
  const { pezzi } = C.pezziOscurati(['la password è «Mela', '! Verde77»'], 'la password è «Mela! Verde77»', 0);
  assert.doesNotMatch(pezzi.join(''), /Mela|Verde77/);
});

test('una frase usata come password fra virgolette si toglie come senza virgolette', () => {
  assert.equal(P.oscura('Password: «cavallo batteria graffetta»'), `Password: «${S}»`);
  assert.equal(P.oscura('Password: cavallo batteria graffetta'), `Password: ${S}`);
});

test('la parola dopo la punteggiatura fra virgolette resta della password', () => {
  const valori = X.segretiDetti('la password è «mela! verde77»').map((x) => x.valore);
  assert.ok(valori.includes('verde77'), JSON.stringify(valori));
  assert.deepEqual(X.segretiDetti('la password è gatto2024. poi ci vediamo alle 18').map((x) => x.valore), ['gatto2024']);
});

test('fuori dalle virgolette della password il testo resta', () => {
  assert.equal(P.oscura('la password è « Mela! Verde77 » e il nome «Mario Rossi»'),
    `la password è « ${S} » e il nome «Mario Rossi»`);
  assert.equal(P.oscura('lui ha detto "la password è Gatto2024, fidati"'), `lui ha detto "la password è ${S}, fidati"`);
  for (const frase of ['Password: « deve avere almeno otto caratteri »', 'Ho detto « ciao a tutti » a Marco', 'il titolo è “La casa”']) {
    assert.equal(P.oscura(frase), frase);
  }
});
