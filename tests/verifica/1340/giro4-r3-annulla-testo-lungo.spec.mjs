// #1340, giro 4, rilievo 3: in una casella di Filo con un testo molto lungo (un log incollato) Ctrl+Z non annulla
// più niente: lo stato a cui torna è uscito dalla memoria dei testi già avuti, e la guardia lo prende per il sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi } from '../../helpers/riquadri.mjs';

test('r3 feedback: testo di 100.000 caratteri, una parola scritta in fondo, Ctrl+Z la toglie', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><head><meta charset="utf-8"></head><body style="padding:40px"><p>Un sito</p></body></html>');
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'Log: '.padEnd(100000, 'abcdefghij '));
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  await page.keyboard.type('x'.repeat(60));
  await page.waitForTimeout(1000);
  const prima = (await statoDi(app, page, '.sn-fb-text')).valore.length;
  expect(prima).toBe(100060);
  await page.keyboard.press('Control+Z');
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text')).valore.length, { timeout: 5_000 }).toBeLessThan(prima);
});
