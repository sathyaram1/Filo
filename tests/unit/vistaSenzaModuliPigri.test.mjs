// Sentinella (#2136): la nascita di una vista non carica moduli. Una valutazione dell'ispettore (app.evaluate delle
// prove) entra anche a metà del codice sincrono, e un modulo caricato per la prima volta lì dentro si trova senza
// esportazioni: «require(...).attach is not a function» sulla prima scheda aperta subito dopo l'avvio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SORGENTE = readFileSync(fileURLToPath(new URL('../../src/main/tabs.js', import.meta.url)), 'utf8');

function corpoDelMetodo(nome) {
  const riga = new RegExp(`^  ${nome}\\(.*\\) \\{$`, 'm').exec(SORGENTE);
  assert.ok(riga, `${nome} non trovato in tabs.js`);
  const inizio = riga.index;
  let profondita = 0;
  for (let i = inizio + riga[0].length - 1; i < SORGENTE.length; i++) {
    if (SORGENTE[i] === '{') profondita++;
    else if (SORGENTE[i] === '}' && --profondita === 0) return SORGENTE.slice(inizio, i + 1);
  }
  throw new Error(`${nome}: graffe non chiuse`);
}

test('chi fa nascere una vista non carica moduli: li trova già caricati con tabs.js', () => {
  for (const nome of ['_makeView', '_preferenzeWeb']) {
    const corpo = corpoDelMetodo(nome);
    assert.ok(corpo.length > 200, `${nome}: corpo troppo corto, l'estrazione si è rotta`);
    assert.doesNotMatch(corpo, /\brequire\s*\(/, `${nome} carica un modulo: va richiesto in cima a tabs.js`);
  }
});

test('la rete di casa e gli scaricamenti che la vista aggancia sono richiesti in cima a tabs.js', () => {
  const inCima = SORGENTE.slice(0, SORGENTE.search(/^class /m));
  assert.match(inCima, /^const \w+ = require\('\.\/services\/homeNetwork'\);$/m);
  assert.match(inCima, /^const \w+ = require\('\.\/services\/downloads'\);$/m);
});
