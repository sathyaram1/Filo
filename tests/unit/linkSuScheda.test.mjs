// Un collegamento lasciato sulla fila delle schede (#2393): passano solo indirizzi del web, su una scheda la si porta
// lì e la si mette davanti, fra due ne nasce una nuova in quel posto. Il gesto vero lo prova tests/link-su-scheda.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ricevi, indirizzoDelWeb, MAX_URL } = require('../../src/main/linkSuScheda.js');
require('../../src/shared/indirizziTrascinati.js');
const { primo: primoIndirizzo } = globalThis.SN_INDIRIZZI_TRASCINATI;

function finta(ids = ['a', 'b']) {
  const fatto = [];
  const tm = {
    tabs: ids.map((id) => ({ id })),
    navigate: (id, url) => fatto.push(['navigate', id, url]),
    activate: (id) => fatto.push(['activate', id]),
    openTab: (url) => { fatto.push(['openTab', url]); tm.tabs.push({ id: 'n' }); return 'n'; },
    moveTab: (id, i, o) => fatto.push(['moveTab', id, i, o]),
  };
  return { tm, fatto };
}

test('solo indirizzi del web: niente javascript:, file:, data:, pagine di Filo o testo qualunque', () => {
  assert.equal(indirizzoDelWeb(' https://www.youtube.com/watch?v=x '), 'https://www.youtube.com/watch?v=x');
  assert.equal(indirizzoDelWeb('http://127.0.0.1:8080/a'), 'http://127.0.0.1:8080/a');
  for (const no of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'filo://options/options.html',
    'ciao mondo', '', null, 42, `https://a.it/${'x'.repeat(MAX_URL)}`]) {
    assert.equal(indirizzoDelWeb(no), '', String(no).slice(0, 40));
  }
});

test('su una scheda: la porta al collegamento e la mette davanti', () => {
  const { tm, fatto } = finta();
  assert.equal(ricevi(tm, { url: 'https://a.it/v', id: 'b' }), 'b');
  assert.deepEqual(fatto, [['navigate', 'b', 'https://a.it/v'], ['activate', 'b']]);
});

test('su una scheda che non c\'è più, o con un indirizzo rifiutato, non succede niente', () => {
  const { tm, fatto } = finta();
  assert.equal(ricevi(tm, { url: 'https://a.it/v', id: 'z' }), null);
  assert.equal(ricevi(tm, { url: 'javascript:alert(1)', id: 'a' }), null);
  assert.equal(ricevi(tm, { url: 'javascript:alert(1)', indice: 0 }), null);
  assert.deepEqual(fatto, []);
});

test('fra due schede ne nasce una nuova in quel posto; senza posto resta in fondo', () => {
  const { tm, fatto } = finta();
  assert.equal(ricevi(tm, { url: 'https://a.it/v', indice: 1 }), 'n');
  assert.deepEqual(fatto, [['openTab', 'https://a.it/v'], ['moveTab', 'n', 1, { trascinata: false }]]);
  const due = finta();
  ricevi(due.tm, { url: 'https://a.it/v' });
  assert.deepEqual(due.fatto, [['openTab', 'https://a.it/v']]);
});

test('dall\'elenco di indirizzi conta il primo vero, saltando i commenti; senza elenco il testo', () => {
  assert.equal(primoIndirizzo('# titolo\r\nhttps://a.it/1\r\nhttps://a.it/2', ''), 'https://a.it/1');
  assert.equal(primoIndirizzo('', ' https://a.it/t '), 'https://a.it/t');
  assert.equal(primoIndirizzo(null, null), '');
});
