// L'allarme che apre un feedback quando la pubblicazione si ferma
// (scripts/build-alarm.mjs): il server tiene 10.000 caratteri di testo e
// taglia il resto in silenzio. Il taglio si fa prima di spedire e si DICE,
// col numero (giro del 14/09, terza verifica).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { testoEntroIlTetto, TETTO_TESTO } = await import('../../scripts/build-alarm.mjs');

test('un testo entro il tetto passa intero', () => {
  assert.equal(testoEntroIlTetto('ciao'), 'ciao');
  const giusto = 'x'.repeat(TETTO_TESTO);
  assert.equal(testoEntroIlTetto(giusto), giusto);
  assert.equal(testoEntroIlTetto(''), '');
  assert.equal(testoEntroIlTetto(null), '');
});

test('un testo oltre il tetto viene tagliato entro il tetto, e il taglio è scritto in coda col numero', () => {
  const lungo = 'r'.repeat(12700);
  const t = testoEntroIlTetto(lungo);
  assert.ok(t.length <= TETTO_TESTO, `${t.length} caratteri: oltre il tetto`);
  assert.match(t, /testo tagliato a 10000 caratteri \(era di 12700\)/);
  assert.match(t, /Actions/);
  assert.ok(t.startsWith('rrrr'), 'l\'inizio del testo resta');
});

test('il tetto si può passare, e la nota rientra sempre nel tetto', () => {
  const t = testoEntroIlTetto('abcdefghij'.repeat(30), 120);
  assert.ok(t.length <= 120);
  assert.match(t, /era di 300/);
});
