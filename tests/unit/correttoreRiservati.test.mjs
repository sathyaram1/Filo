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
