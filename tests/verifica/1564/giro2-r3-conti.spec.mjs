// Verifica #1564 giro 1, rilievo 3: la parte fissa tiene ancora le tabelle scritte a mano di conti e cambi.
import { test, expect } from '../../fixtures/electron.mjs';

test('r3 la parte fissa spiega il segnaposto dei conti, senza i nomi delle valute e i fattori delle unità scritti a mano', async ({ app }) => {
  const s = await app.evaluate(() => globalThis.SN_CONST.PROMPTS.filoChatStatic());
  expect(s).toMatch(/\[\[calc:/);
  expect(s, 'tabella dei nomi delle valute').not.toMatch(/rupie = INR/);
  expect(s, 'tabella dei fattori delle unità').not.toMatch(/1 mi = 1\.609 km/);
});
