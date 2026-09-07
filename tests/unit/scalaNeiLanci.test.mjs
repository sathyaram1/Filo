// Sentinella: la manopola dello zoom di sistema deve arrivare a OGNI porta da
// cui si apre Filo, e un valore sbagliato deve fermare, non passare in silenzio.
//
// Lo schermo di chi sviluppa Filo sta al 125%, quello delle routine in cloud al
// 100%, e una manciata di spec diverge solo per quello. `FILO_TEST_SCALE=1.25`
// rimette quel fattore anche altrove, ed è l'unico modo di rivedere quei rossi
// senza avere lo stesso schermo sotto mano.
//
// Il guaio è che quando la manopola NON arriva non si vede niente: lo spec gira
// al 100% e passa, e chi l'ha lanciata crede di aver provato una cosa che non ha
// provato. È già successo due volte. La prima con lo spec dell'editor, che si
// apre Filo per conto suo. La seconda con il pilota condiviso da cui passano la
// cattura composita e il comando con cui si GUARDA una modifica visiva: la
// sentinella di allora guardava solo dentro i file degli spec, e un lancio
// scritto in un file di strumenti le passava sotto il naso.
//
// Quindi adesso la regola è sul LANCIO, non sul tipo di file: ovunque sotto
// tests/ qualcuno chiami `electron.launch`, nello stesso file deve comparire
// `argomentiScala`. `tests/smoke.mjs` non entra: apre Filo con `spawn` e prova
// l'avvio, non il layout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS = join(__dirname, '..');

// Tutti i .mjs sotto tests/, escluse le cartelle di lavoro rigenerate.
function fileDiTest(dir = TESTS, out = []) {
  for (const nome of readdirSync(dir)) {
    if (nome.startsWith('.') || nome === 'node_modules') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) fileDiTest(p, out);
    else if (nome.endsWith('.mjs')) out.push(p);
  }
  return out;
}

test('ogni lancio di Electron sotto tests/ passa il fattore di scala', () => {
  const senza = [];
  for (const p of fileDiTest()) {
    const src = readFileSync(p, 'utf8');
    if (!/electron\.launch\s*\(/.test(src)) continue;
    if (!src.includes('argomentiScala')) senza.push(relative(TESTS, p));
  }
  assert.deepEqual(senza, [],
    'questi file aprono Filo ignorando FILO_TEST_SCALE: '
    + 'importa `argomentiScala` da ./helpers/scala.mjs (o dalla fixture) e passalo in args');
});

test('un fattore di scala scritto male ferma invece di girare al 100% in silenzio', async () => {
  const { leggiScala } = await import('../helpers/scala.mjs');
  // Vuoto o assente: nessuna manopola, si gira al 100% ed è quello che si voleva.
  for (const niente of [undefined, null, '', '   ']) assert.equal(leggiScala(niente), 0);
  // Valori buoni.
  for (const [testo, atteso] of [['1', 1], ['1.25', 1.25], ['2', 2], [' 1.5 ', 1.5]]) {
    assert.equal(leggiScala(testo), atteso);
  }
  // Valori sbagliati: devono rompere, e il messaggio deve dire cosa fare.
  for (const brutto of ['125', 'abc', '0', '-1', '10', 'NaN']) {
    assert.throws(() => leggiScala(brutto), /FILO_TEST_SCALE/, `"${brutto}" doveva fermare`);
  }
  // Il caso di battitura più probabile suggerisce il valore giusto.
  assert.throws(() => leggiScala('125'), /Forse intendevi 1\.25/);
});
