// Sentinella della password che dice «pagina d'accesso» (#1808): la stessa regola prima e dopo l'invio, e l'accesso fisso
// del sito (testata, menu, colonna laterale) non conta mai come sessione scaduta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/accessoFisso.js');
const { FISSO, passwordDiAccesso, CONTROLLA_JS } = globalThis.SN_ACCESSO_FISSO;

// Un campo finto: `dentro` è l'elenco dei contenitori che lo racchiudono.
const campo = (dentro = [], visibile = true) => ({
  getClientRects: () => (visibile ? [{}] : []),
  closest: (sel) => (dentro.some((d) => sel.split(',').includes(d)) ? {} : null),
});
const doc = (...campi) => ({ querySelectorAll: () => campi });

test('l\'accesso in testata, nel menu o nella colonna laterale non è una pagina d\'accesso', () => {
  for (const d of ['header', 'nav', 'aside', '[role=banner]', '[role=navigation]', '[role=complementary]']) {
    assert.equal(passwordDiAccesso(doc(campo([d])), null), false, d);
  }
  assert.ok(FISSO.split(',').includes('aside'));
});

test('una password nel contenuto della pagina, visibile e fuori dal modulo mandato, sì', () => {
  assert.equal(passwordDiAccesso(doc(campo(['main'])), null), true);
  assert.equal(passwordDiAccesso(doc(campo(['main'], false)), null), false);
  const pw = campo(['main']);
  assert.equal(passwordDiAccesso(doc(pw), { contains: (e) => e === pw }), false);
});

test('il controllo iniettato nelle pagine usa la stessa regola', () => {
  const fn = new Function('document', 'location', `return ${CONTROLLA_JS};`);
  const loc = { pathname: '/accedi' };
  assert.deepEqual(fn({ querySelectorAll: () => [campo(['aside'])], title: 'Grazie' }, loc), { pw: false, dove: '/accedi', titolo: 'Grazie' });
  assert.equal(fn({ querySelectorAll: () => [campo(['main'])], title: 'Accedi' }, loc).pw, true);
});
