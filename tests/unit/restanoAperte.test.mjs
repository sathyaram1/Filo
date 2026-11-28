// SN_RESTANO_APERTE (#1695, #2086): il conto e la frase delle schede rimaste aperte dopo una chiusura in blocco chiesta
// in chat, uguali nel diario (#413) e nella riga che il modello legge dopo un OK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sorgenteHandlers } from '../helpers/sorgenteHandlers.mjs';

const require = createRequire(import.meta.url);
const R = require('../../src/shared/restanoAperte.js');

test('conto per motivo, vuoto senza schede rimaste', () => {
  assert.deepEqual(R.conto([]), {});
  assert.deepEqual(R.conto(undefined), {});
  assert.deepEqual(R.conto(['testo', 'sempre', 'testo']), { restano: 3, restanoPer: { testo: 2, sempre: 1 } });
});

test('la frase nomina ogni motivo col suo numero', () => {
  assert.equal(R.frase({}), '');
  assert.equal(R.frase(R.conto(['testo'])), 'una resta aperta col testo non inviato');
  assert.equal(R.frase(R.conto(['testo', 'sempre', 'sempre'])),
    'una resta aperta col testo non inviato, 2 restano aperte, sono di siti tenuti sempre aperti');
  assert.equal(R.frase({ restano: 2 }), '2 restano aperte');
});

test('diario, riga dopo l\'OK e esito per il modello usano lo stesso modulo, senza copie', () => {
  // Le parole del diario, in diretta e nella chat riaperta, le dice SN_ESITO (#1294).
  const diario = readFileSync(new URL('../../src/shared/esitoAzione.js', import.meta.url), 'utf8');
  const livelli = readFileSync(new URL('../../src/shared/actionLevels.js', import.meta.url), 'utf8');
  const handlers = sorgenteHandlers();
  assert.match(diario, /SN_RESTANO_APERTE/);
  assert.match(livelli, /SN_RESTANO_APERTE/);
  for (const f of ['../../src/shared/esitoAzione.js', '../../src/shared/righeAttivita.js', '../../src/pages/dashboard/dashboard-attivita.js',
    '../../src/shared/actionLevels.js']) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /restano aperte col testo|bloccata e l'ho lasciata/, f);
  }
  assert.match(handlers, /restanoAperte\.js'\)\.conto/);
});

// #2086 — la bloccata lasciata da una chiusura in blocco si dice per prima, con le parole dell'owner.
test('la bloccata lasciata si dice: «una era bloccata e l\'ho lasciata»', () => {
  assert.equal(R.frase(R.conto(['bloccata'])), 'una era bloccata e l\'ho lasciata');
  assert.equal(R.frase(R.conto(['testo', 'bloccata', 'bloccata'])),
    '2 erano bloccate e le ho lasciate, una resta aperta col testo non inviato');
  require('../../src/shared/actionLevels.js');
  const L = globalThis.SN_ACTION_LEVELS;
  assert.equal(L.describeDone({ type: 'CHIUDI_SCHEDE', _output: { chiuse: 2, ...R.conto(['bloccata']) } }),
    'Chiuse 2 schede: restano nel filo della home; una era bloccata e l\'ho lasciata');
  assert.equal(L.describeDone({ type: 'CHIUDI_SCHEDE', _output: { chiuse: 1, bloccate: 1 } }),
    'Chiusa una scheda (era bloccata): resta nel filo della home');
});
