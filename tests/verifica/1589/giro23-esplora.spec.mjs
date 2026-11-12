// #1589 giro 23 — esplorazione: il testo dei campi dopo la cura del giro 22 su una pagina di sanità e su un sito in
// anticipo, e uno sguardo alla sezione privacy in Sicurezza nei due temi.
import { test, expect } from '../../fixtures/electron.mjs';

const SANITA = 'sanita-di-prova.test';
const PAGINA = `<!doctype html><html><head><title>Scrivi</title></head>
<body style="margin:0;padding:24px;font-family:sans-serif">
  <form method="post"><textarea name="messaggio" id="messaggio" style="width:420px;height:120px"></textarea></form>
</body></html>`;

function quanti(app) {
  return app.evaluate(async () => {
    const rq = process.mainModule.require;
    const T = rq(rq('node:path').join(process.cwd(), 'src/main/services/testoDeiCampi.js'));
    return (await T.stato()).campi;
  });
}

test.describe('testo dei campi e livelli', () => {
  test.use({ hostInPiu: [SANITA] });

  test('sanità di serie non tiene il testo; messa in anticipo lo tiene', async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    await app.evaluate(({}, h) => {
      const P = globalThis.SN_PAGINE_DELICATE.PREDEFINITI;
      if (!P.sanita.includes(h)) P.sanita.push(h);
    }, SANITA);
    const url = testServer.html(PAGINA).replace('127.0.0.1', SANITA);
    const page = await openTab(url);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
    await page.locator('#messaggio').click();
    await page.keyboard.type('referto da chiedere al medico');
    await page.waitForTimeout(1500);
    expect(await quanti(app)).toBe(0);

    await app.evaluate(({}, h) => globalThis.SN_STORAGE.updateSettings({ security: { privacy: { sitiAnticipo: [h] } } }), SANITA);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
    await page.locator('#messaggio').click();
    await page.keyboard.type('secondo testo');
    await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
    await expect.poll(() => page.locator('#messaggio').inputValue(), { timeout: 8000 }).toBe('secondo testo');
  });
});

test('sezione privacy in Sicurezza, chiaro e scuro', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const s = await openTab('filo://security/security.html');
  await expect(s.locator('#sec-privacy-title')).toBeVisible({ timeout: 8000 });
  await s.locator('#sec-privacy').scrollIntoViewIfNeeded();
  await s.locator('#sec-privacy').screenshot({ path: 'tests/.shots/1589-g23-chiaro.png' });
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' }));
  await s.waitForTimeout(600);
  await s.locator('#sec-privacy').screenshot({ path: 'tests/.shots/1589-g23-scuro.png' });
  await s.setViewportSize({ width: 420, height: 900 }).catch(() => {});
  await s.waitForTimeout(300);
  await s.locator('#sec-privacy').screenshot({ path: 'tests/.shots/1589-g23-stretto.png' });
});
