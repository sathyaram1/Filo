// #1446 — chiavi, password e numeri di carta scritti in un campo non partono verso i modelli del correttore: al loro
// posto un segnaposto, e il resto del testo resta com'è perché il modello lo possa citare.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/urlExfil.js');
const R = require('../../src/main/services/correttoreRiservati.js');

test('carta a gruppi, chiave e password detta escono come segnaposto; il resto resta uguale', () => {
  const testo = 'Ti mando la carta 4111 1111 1111 1111, la chiave sk-abcdefghijklmnopqrstuvwx e la password wifi gattonero. Oggi sonno andato al mare.';
  const fuori = R.oscura(testo);
  for (const segreto of ['4111', 'sk-abcdef', 'gattonero']) assert.ok(!fuori.includes(segreto), `${segreto} è partito`);
  assert.ok(fuori.includes('Oggi sonno andato al mare.'));
  assert.equal(R.oscura('oggi sonno andato al mare con Luca'), 'oggi sonno andato al mare con Luca');
});

test('ogni parte della richiesta che porta testo passa dal segnaposto, anche la pagina intorno e i candidati', () => {
  const carta = '4111111111111111';
  const p = R.richiestaSenzaRiservati({
    prima: `carta ${carta}`, nuovo: `ancora ${carta}`, dopo: carta, candidati: [{ pezzo: carta, perche: 'x' }],
    luogo: { sito: 'banca.example', titolo: carta, conversazione: carta }, contesto: { prima: carta, dopo: carta },
  });
  assert.ok(!JSON.stringify(p).includes(carta));
  assert.equal(p.luogo.sito, 'banca.example');
  assert.equal(p.candidati[0].perche, 'x');
});

// La parola che presenta il dato e il dato possono partire in pezzi diversi, o la parola restare fuori dai pezzi: si
// cerca nel campo intero, e il campo non parte.
test('una password scritta dopo una pausa e una carta a metà fra due pezzi non partono', () => {
  const pw = R.richiestaSenzaRiservati({ prima: 'ciao Marco, la password del wifi è ', nuovo: 'Gatto2024', dopo: ' a presto' });
  assert.ok(!JSON.stringify(pw).includes('Gatto2024'));
  const carta = R.richiestaSenzaRiservati({ prima: 'la carta è 4111 1111 ', nuovo: '1111 1111', dopo: ' grazie' });
  assert.ok(!/1111/.test(JSON.stringify(carta)), JSON.stringify(carta));
  assert.equal(carta.dopo, ' grazie');
});

test('la parola che presenta la password sta nel campo, fuori dai pezzi: il valore non parte, e il campo nemmeno', () => {
  const campo = 'la password del wifi è gattonero e Gatto2024, ci vediamo';
  const da = campo.indexOf('è gattonero');
  const nuovo = 'Gatto2024';
  const i = campo.indexOf(nuovo);
  const p = R.richiestaSenzaRiservati({
    prima: campo.slice(da, i), nuovo, dopo: campo.slice(i + nuovo.length), campo, campoDa: da,
    candidati: [{ pezzo: 'gattonero', perche: 'x' }],
  });
  for (const segreto of ['gattonero', 'Gatto2024']) assert.ok(!JSON.stringify(p).includes(segreto), `${segreto} è partito`);
  assert.equal('campo' in p, false);
  assert.equal('campoDa' in p, false);
  assert.equal(p.dopo, ', ci vediamo');
});

test('un campo che non torna coi pezzi non conta: vale il testo dei pezzi', () => {
  const p = R.richiestaSenzaRiservati({ prima: 'ciao ', nuovo: 'oggi sonno andato', dopo: '', campo: 'la password è sonno', campoDa: 0 });
  assert.equal(p.nuovo, 'oggi sonno andato');
});
