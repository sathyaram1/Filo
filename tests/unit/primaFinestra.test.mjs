// Sentinella: sotto tests/ una finestra di Filo non si prende mai appena annunciata (`firstWindow()` nudo,
// `waitForEvent('window')`): da Electron 44 arriva vuota e naviga subito dopo, e lo spec cade con «Execution context
// was destroyed». Le prove dei giri (tests/verifica/) restano com'erano: le scrive e le corre chi verifica.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const TESTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const ESCLUSI = [join('helpers', 'primaFinestra.mjs'), join('unit', 'primaFinestra.test.mjs')];

function fileDiTest(dir = TESTS, out = []) {
  for (const nome of readdirSync(dir)) {
    if (nome.startsWith('.') || nome === 'node_modules' || nome === 'verifica') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) fileDiTest(p, out);
    else if (/\.(mjs|js|cjs)$/.test(nome)) out.push(p);
  }
  return out;
}

// I commenti che spiegano perché non si fa (la fixture lo fa) non sono chiamate.
function righeDiCodice(testo) {
  return testo.split('\n').filter((r) => !/^\s*(\/\/|\/?\*)/.test(r)).join('\n');
}

const FIRST_WINDOW = /\.firstWindow\s*\(/;
const ATTESA_WINDOW = /\.waitForEvent\s*\(\s*['"`]window['"`]/;

function chiChiama(re) {
  return fileDiTest()
    .filter((p) => !ESCLUSI.some((e) => p.endsWith(e)))
    .filter((p) => re.test(righeDiCodice(readFileSync(p, 'utf8'))))
    .map((p) => relative(TESTS, p).replace(/\\/g, '/'));
}

test('i due riconoscitori prendono le chiamate e lasciano stare i commenti', () => {
  assert.ok(FIRST_WINDOW.test(righeDiCodice('const s = await app.firstWindow({ timeout: 5000 });')));
  assert.ok(ATTESA_WINDOW.test(righeDiCodice("const p = await app.waitForEvent('window');")));
  assert.ok(ATTESA_WINDOW.test(righeDiCodice('const p = await app.waitForEvent( "window", { timeout: 1 });')));
  assert.ok(!ATTESA_WINDOW.test(righeDiCodice("  // app.waitForEvent('window') può risolvere con la newtab")));
  assert.ok(!ATTESA_WINDOW.test(righeDiCodice("await page.waitForEvent('popup');")));
});

test('la prima finestra di Filo si aspetta col suo documento, non con firstWindow() nudo', () => {
  assert.deepEqual(chiChiama(FIRST_WINDOW), [], 'usa `primaFinestra(app)` da tests/helpers/primaFinestra.mjs');
});

test("nessuna finestra si prende con waitForEvent('window'): risolve alla nascita, vuota, o con la scheda sbagliata", () => {
  assert.deepEqual(chiChiama(ATTESA_WINDOW), [],
    'la prima finestra con `primaFinestra(app)`; una scheda con `openTab` della fixture o filtrando `app.windows()` per indirizzo');
});
