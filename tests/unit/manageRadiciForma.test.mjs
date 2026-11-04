// #1918: il cartellino delle radici in Gestione sa da quale fonte viene una radice dai campi del server (`sessione`,
// `tipo`), non rileggendo a mano il formato: cambiato il formato sul server, il cartellino direbbe ancora la cosa giusta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sorgente = readFileSync(join(ROOT, 'src', 'pages', 'manage', 'manageRadici.js'), 'utf8');

function carica() {
  const window = {};
  vm.runInNewContext(sorgente, { window, URL, document: {} });
  return window.SN_MANAGE_RADICI;
}

test('la sessione sporca si riconosce dal campo del server, qualunque forma abbia la radice', () => {
  const R = carica();
  const x = { radice: 'esterno:biglietto 0123456789abcdef mvnrzpc0', tipo: 'esterno', valore: 'biglietto 0123456789abcdef mvnrzpc0', sessione: true, letture: ['ha letto la posta'] };
  assert.equal(R.etichetta(x), 'sessione sporca');
  assert.match(R.titolo(x), /ha letto la posta/);
  assert.equal(R.etichetta(Object.assign({}, x, { valore: 'altra forma', sessione: true })), 'sessione sporca');
  assert.equal(R.etichetta({ radice: 'esterno:nota f1 del manutentore x', tipo: 'esterno', valore: 'nota f1 del manutentore x', sessione: false }), 'esterno');
});

test('il cartellino non rilegge a mano il formato delle radici speciali', () => {
  assert.doesNotMatch(sorgente, /biglietto \//, 'la forma della radice del biglietto la conosce solo il server');
});

test('radici con lo stesso nome sul cartellino portano un numero, e si distinguono senza passarci sopra', () => {
  const bottoni = [];
  const doc = { createElement: () => { const b = { dataset: {}, setAttribute() {}, addEventListener() {} }; return b; } };
  const window = {};
  vm.runInNewContext(sorgente, { window, URL, document: doc });
  const box = { set textContent(v) { bottoni.length = 0; }, appendChild: (b) => bottoni.push(b), hidden: false };
  const pagina = (n) => ({ radice: `web:#${String(n).repeat(16)}`, tipo: 'web', valore: `#${String(n).repeat(16)}`, nome: `web:https://github.com/p${n}`, timbrabile: true });
  window.SN_MANAGE_RADICI.disegna(box, [pagina(1), pagina(2), { radice: 'legacy', tipo: 'legacy', valore: '', timbrabile: true }, pagina(3)], () => {});
  assert.deepEqual(bottoni.map((b) => b.textContent), ['github.com 1', 'github.com 2', 'nato prima', 'github.com 3']);
});
