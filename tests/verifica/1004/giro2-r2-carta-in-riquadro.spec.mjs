// #1004 giro 2, rilievo 2: il campo carta che un servizio di pagamento mette in un riquadro suo, dentro la cassa di un
// negozio, rende delicata la cassa come un campo carta nella pagina stessa.

import { test, expect } from '../../fixtures/electron.mjs';

test('un campo carta in un riquadro di un altro sito rende delicata la pagina che lo contiene', async ({ app, openTab, testServer }) => {
  const riquadro = testServer.html('<!doctype html><html><body><input autocomplete="cc-number" name="cardnumber"></body></html>')
    .replace('127.0.0.1', 'blocked.test');
  const cassa = await testServer.openReady(openTab,
    `<!doctype html><html><head><title>Cassa</title></head><body><p>Spedizione a Mario Rossi, via Roma 1</p><iframe src="${riquadro}"></iframe></body></html>`,
    { pubblico: true });
  await cassa.waitForTimeout(2500);
  await cassa.frameLocator('iframe').locator('input[name=cardnumber]').click();
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
});
