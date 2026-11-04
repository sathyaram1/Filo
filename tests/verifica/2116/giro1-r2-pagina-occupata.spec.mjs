// Verifica #2116 giro 1, rilievo 2: su una pagina senza campi segreti ma occupata per qualche secondo il riquadro
// del feedback dice che lo screenshot non è partito per un campo riservato che non c'è.

import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, paginaDelloStrato } from '../../helpers/riquadri.mjs';

test('r2 su una pagina occupata senza campi segreti il feedback non inventa un campo riservato', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><head><meta charset="utf-8"><title>Notizie</title></head>'
    + '<body><h1>Notizie</h1><p>Un articolo qualunque, nessun modulo.</p></body></html>');
  await app.evaluate(() => {
    globalThis.__rete = { payload: [] };
    globalThis.SN_FEEDBACK.submit = async (p) => {
      globalThis.__rete.payload.push(p);
      return { id: `fb-${globalThis.__rete.payload.length}`, seq: 1, failed: [] };
    };
  });
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-fb-modal')).toBeVisible();
  await strato.locator('.sn-fb-text').fill('La pagina si è bloccata');
  await strato.locator('.sn-fb-clear').click();
  // La pagina resta bloccata otto secondi, come un sito pesante che si è piantato: è proprio lì che si manda un feedback.
  page.evaluate(() => { const fine = Date.now() + 8000; while (Date.now() < fine); }).catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
  await strato.locator('.sn-fb-send').click();
  await expect.poll(() => app.evaluate(() => globalThis.__rete.payload.length), { timeout: 20_000 }).toBe(1);
  const avviso = strato.locator('.sn-toast').filter({ hasText: 'Feedback inviato' });
  await expect(avviso).toHaveCount(1, { timeout: 8_000 });
  const testo = await avviso.textContent();
  const immagini = await app.evaluate(() => globalThis.__rete.payload[0].images.length);
  expect(immagini === 1 || !/campo riservato/.test(testo),
    `nella pagina non c'è nessun campo riservato, ma il riquadro dice: «${testo}»`).toBe(true);
});
