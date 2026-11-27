// #2692.4 — un PIN, un CVV o un codice scritto con le cifre separate («4-8-2-1», «4 8 2 1», «4.8.2.1») non arriva al
// modello: né dal pavimento né dal correttore, detto nella frase o dato in risposta a chi lo chiede. Date, versioni,
// indirizzi IP e numeri che non aprono niente restano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { rapportoFraCosti } from '../helpers/tempoRelativo.mjs';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/urlExfil.js');
const P = require('../../src/shared/pavimento.js');
const RT = require('../../src/shared/riservatiNelTesto.js');
const C = require('../../src/main/services/correttoreRiservati.js');
const S = P.SEGNAPOSTO;

const SCANDITI = [
  ['Il pin della carta è 4-8-2-1', `Il pin della carta è ${S}`],
  ['Il pin della carta è 4 8 2 1', `Il pin della carta è ${S}`],
  ['il pin è 4.8.2.1', `il pin è ${S}`],
  ['Il PIN: 4–8–2–1', `Il PIN: ${S}`],
  ['PIN 4 8 2 1 5', `PIN ${S}`],
  ['Il codice del cancello è 4-8-2-1', `Il codice del cancello è ${S}`],
  ['la password è 4 8 2 1', `la password è ${S}`],
  ['il cvv è 1 2 3', `il cvv è ${S}`],
  ['il cvv è 1-2-3', `il cvv è ${S}`],
  ['Il pin della carta è 4 8 2 1, ordine del 7 maggio', `Il pin della carta è ${S}, ordine del 7 maggio`],
  ['Carta 4 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1', `Carta ${S}`],
];

test('le cifre scandite al posto del valore diventano il segnaposto, nel pavimento e nel correttore', () => {
  for (const [frase, atteso] of SCANDITI) {
    assert.equal(P.oscura(frase), atteso, `pavimento: ${frase}`);
    assert.equal(C.oscura(frase), atteso, `correttore: ${frase}`);
  }
});

test('la risposta scandita sotto chi chiede il PIN non arriva al modello', () => {
  for (const risposta of ['4-8-2-1', '4 8 2 1', '4.8.2.1']) {
    const sopra = 'Marco: qual è il pin della carta?';
    assert.equal(P.oscura(`${sopra}\n${risposta}`), `${sopra}\n${S}`, `pavimento: ${risposta}`);
    const r = C.richiestaSenzaRiservati({ nuovo: risposta, sopra });
    assert.equal(r.nuovo, S, `correttore: ${risposta}`);
  }
  const r = C.richiestaSenzaRiservati({ nuovo: 'Luc: è 4 8 2 1', sopra: 'Marco: mi mandi il pin?' });
  assert.equal(r.nuovo, `Luc: è ${S}`);
});

test('date, versioni, indirizzi, punteggi e numeri che non aprono niente restano', () => {
  for (const frase of [
    'Il server è su 192.168.1.1 e la versione è 1.2.3',
    'Aggiorna alla versione 2.4.1.7 per il codice nuovo',
    'La partita è finita 3-1-0',
    'Passi: 1 2 3 4 5, poi salva',
    'Il codice prodotto è 1 2 3 4 5',
    'La riunione è il 4-8-2026 alle 10.30',
    'Ho pagato il 4-8-2021 con la carta',
    'Ho letto i capitoli 1, 2, 3 e 4',
  ]) {
    assert.equal(P.oscura(frase), frase, `pavimento: ${frase}`);
    assert.equal(C.oscura(frase), frase, `correttore: ${frase}`);
  }
});

test('la copia con le cifre attaccate riporta ogni carattere al suo posto nel testo vero', () => {
  assert.equal(RT.cifreAttaccate('niente da attaccare 4821'), null);
  assert.equal(RT.cifreAttaccate('4-8-2021'), null);
  const t = 'pin 4 8 2 1 e cvv 1-2-3.';
  const c = RT.cifreAttaccate(t);
  assert.equal(c.piano, 'pin 4821 e cvv 123.');
  for (let k = 0; k < c.piano.length; k++) assert.equal(t[c.posto[k]], c.piano[k]);
  assert.deepEqual(c.tratti, [[4, 11], [18, 23]]);
});

test('un testo lungo pieno di cifre scandite resta lineare', async () => {
  const testo = (n) => 'il pin è 4 8 2 1. '.repeat(n);
  assert.ok(!P.oscura(testo(2000)).includes('4 8 2 1'));
  // Dieci volte il testo costa dieci volte, non cento: il tetto lascia margine al carico, non a un costo quadratico.
  const r = await rapportoFraCosti(() => P.oscura(testo(200)), () => P.oscura(testo(2000)), { tetto: 30, campioni: 3 });
  assert.ok(r.entro, `dieci volte il testo costa ${r.come}`);
});
