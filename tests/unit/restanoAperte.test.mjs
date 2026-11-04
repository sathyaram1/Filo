// SN_RESTANO_APERTE (#1695): il conto e la frase delle schede rimaste aperte, uguali nel diario della chat (#413) e
// nell'avviso di «Chiudi le altre schede».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

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

test('chat e menu della linguetta usano lo stesso modulo, senza copie', () => {
  // Le parole del diario, in diretta e nella chat riaperta, le dice SN_ESITO (#1294).
  const diario = readFileSync(new URL('../../src/shared/esitoAzione.js', import.meta.url), 'utf8');
  const handlers = readFileSync(new URL('../../src/main/services/handlers.js', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../../src/renderer/shell.js', import.meta.url), 'utf8');
  assert.match(diario, /SN_RESTANO_APERTE/);
  for (const f of ['../../src/shared/esitoAzione.js', '../../src/shared/righeAttivita.js', '../../src/pages/dashboard/dashboard-attivita.js']) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /restano aperte col testo/, f);
  }
  assert.match(handlers, /restanoAperte\.js'\)\.conto/);
  assert.match(shell, /SN_RESTANO_APERTE/);
});
