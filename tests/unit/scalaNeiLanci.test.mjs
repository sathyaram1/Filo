// Sentinella: la manopola dello zoom di sistema deve arrivare a TUTTI gli spec.
//
// Lo schermo di chi sviluppa Filo sta al 125%, quello delle routine in cloud al
// 100%, e una manciata di spec diverge solo per quello. `FILO_TEST_SCALE=1.25`
// rimette quel fattore anche altrove, ed è l'unico modo di rivedere quei rossi
// senza avere lo stesso schermo sotto mano.
//
// La manopola vive nella partenza comune (tests/fixtures/electron.mjs), ma una
// ventina di spec si apre Filo per conto suo: lì il fattore va passato a mano
// (`args: [...argomentiScala, '.']`). Chi se lo dimentica non vede niente di
// storto: lo spec gira al 100% e passa, e chi lo lancia con la manopola accesa
// crede di aver provato una cosa che non ha provato. È successo con lo spec
// dell'editor, che era proprio uno di quelli da rivedere al 125% (feedback
// #563).
//
// Questa sentinella diventa rossa se un nuovo spec lancia Electron senza la
// manopola. `tests/smoke.mjs` non è uno spec e non entra: prova l'avvio, non il
// layout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS = join(__dirname, '..');

test('ogni spec che lancia Electron da solo passa il fattore di scala', () => {
  const senza = [];
  for (const nome of readdirSync(TESTS)) {
    if (!nome.endsWith('.spec.mjs')) continue;
    const src = readFileSync(join(TESTS, nome), 'utf8');
    if (!/electron\.launch\s*\(/.test(src)) continue;
    if (!src.includes('argomentiScala')) senza.push(nome);
  }
  assert.deepEqual(senza, [],
    'questi spec si aprono Filo da soli e ignorano FILO_TEST_SCALE: '
    + 'importa `argomentiScala` da ./fixtures/electron.mjs e passalo in args');
});
