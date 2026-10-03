// #589.11 giro 1, rilievo 2: su una pagina tutta in scala di grigi (un filtro sull'intero documento, come fanno
// alcuni siti nei giorni di lutto) il menu si vede benissimo ma nessun clic sulle sue voci passa.
import { test, expect } from '../../fixtures/electron.mjs';

const TESTO = 'testo copiato 589.11';

test('su una pagina in scala di grigi Incolla dal menu funziona', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), TESTO);
  const page = await testServer.openReady(openTab, `<!doctype html><html style="filter:grayscale(1)">
    <body style="padding:40px"><input id="campo" style="width:320px;font-size:16px"></body></html>`);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-main')).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/589-11-r2-grigio.png' });
  await page.locator('.sn-menu-paste-main').click();
  await expect(page.locator('#campo')).toHaveValue(TESTO);
});
