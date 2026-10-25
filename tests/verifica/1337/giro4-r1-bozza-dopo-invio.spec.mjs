// Verifica #1337 giro 4, rilievo 1: Invia premuto subito dopo l'ultima battuta, con la segnalazione messa in coda,
// e il testo mandato torna come bozza alla riapertura del riquadro.

import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, conta, clicca, scrivi } from '../../helpers/riquadri.mjs';

test('r1 il testo appena mandato non torna come bozza alla riapertura del riquadro', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => { globalThis.SN_FEEDBACK_OUTBOX._setAuto(false); });
  const pagina = '<!doctype html><html><head><meta charset="utf-8"></head><body><p>Sito</p></body></html>';
  const page = await testServer.openReady(openTab, pagina);

  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  // Scrive e preme Invia subito dopo, come chi batte l'ultima lettera e clicca.
  await scrivi(app, page, '.sn-fb-text', 'il carrello si svuota da solo');
  await clicca(app, page, '.sn-fb-send');
  await expect.poll(() => conta(app, page, '.sn-fb-modal')).toBe(0);
  await page.waitForTimeout(800);

  const bozza = `sn_feedback_draft_text@${testServer.origin}`;
  expect(await app.evaluate(async (_e, k) => (await globalThis.chrome.storage.local.get([k]))[k] || '', bozza)).toBe('');
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await page.waitForTimeout(500);
  expect((await statoDi(app, page, '.sn-fb-text'))?.valore).toBe('');
});
