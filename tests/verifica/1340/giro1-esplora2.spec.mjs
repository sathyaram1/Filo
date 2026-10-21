// #1340, giro 1: esplorazione, il microfono dell'Aiuto su pagine con zoom o trasformazioni.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

for (const [nome, stile] of [['zoom', 'zoom:1.5'], ['transform', 'transform:translateZ(0)'], ['opacity', 'opacity:.97']]) {
  test(`mic con html ${nome}`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, `<!doctype html><html style="${stile}"><body style="padding:40px"><h1>Sito</h1></body></html>`);
    const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
    await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
    await expect(page.locator('.sn-sidebar-input textarea')).toBeVisible({ timeout: 8_000 });
    await nelMondoDiFilo(app, page, () => {
      globalThis.__ascolti = 0;
      globalThis.SN_ASCOLTO.avvia = async () => { globalThis.__ascolti += 1; return null; };
      return true;
    });
    await page.waitForTimeout(1200);
    await page.locator('.sn-sidebar .sn-voce-btn').click();
    await page.waitForTimeout(600);
    const n = await nelMondoDiFilo(app, page, () => globalThis.__ascolti);
    console.log(nome, 'ascolti', n);
    expect(n).toBe(1);
  });
}
