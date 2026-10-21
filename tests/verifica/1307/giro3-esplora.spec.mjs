// Verifica #1307, giro 3: esplorazione. Il link di un disegno SVG al clic (avviso prima del clic), e il menu aperto
// da tastiera su una zona di mappa e su un link SVG.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const verdettoPronto = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      const v = t._sbLinkSegnalati && t._sbLinkSegnalati.get(u);
      if (v) return v.level;
    }
  }
  return null;
}, url);

test('esplora: verdetto prima del clic per link HTML, zona di mappa e link SVG verso un sosia', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: async () => null, gsbPeek: null, rdap: async () => null, ct: async () => null, llm: async () => null, sandbox: async () => null });
  });
  await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <p><a id="html" href="https://paypa1.com/html">Accedi</a></p>
    <img src="${PX}" usemap="#m" width="200" height="100" style="background:#e07b39" alt="x">
    <map name="m"><area shape="rect" coords="0,0,100,100" href="https://paypa1.com/area" alt="Accedi"></map>
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><a href="https://paypa1.com/svg"><rect width="320" height="120" fill="#e07b39"/></a></svg>
  </body></html>`);
  await expect.poll(() => verdettoPronto(app, 'https://paypa1.com/html'), { timeout: 8000 }).toBe('pericoloso');
  const esiti = {
    area: await verdettoPronto(app, 'https://paypa1.com/area'),
    svg: await verdettoPronto(app, 'https://paypa1.com/svg'),
  };
  console.log('VERDETTI', JSON.stringify(esiti));
});

test('esplora: menu da tastiera su un link SVG e su una zona di mappa verso un sosia', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <button id="prima">prima</button>
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><a id="svglink" href="https://paypa1.com/svg"><rect width="320" height="120" fill="#e07b39"/></a></svg>
    <img src="${PX}" usemap="#m" width="200" height="100" style="background:#e07b39" alt="x">
    <map name="m"><area id="zona" shape="rect" coords="0,0,100,100" href="https://paypa1.com/area" alt="Accedi"></map>
  </body></html>`);
  for (const id of ['svglink', 'zona']) {
    await page.evaluate((i) => document.getElementById(i).focus(), id);
    const att = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
    await page.keyboard.press('Shift+F10');
    const menu = menuDi(page);
    const avviso = menu.locator('.sn-menu .sn-menu-inline[data-subject="link"] .sn-menu-link-warn');
    let testo = '';
    try { await expect(avviso).toBeVisible({ timeout: 4000 }); testo = await avviso.innerText(); } catch (_) { testo = 'NESSUN AVVISO'; }
    let voci = [];
    try { voci = await menu.locator('.sn-menu-item').allInnerTexts(); } catch (_) {}
    console.log('TASTIERA', id, 'fuoco=', att, '|', testo, '|', JSON.stringify(voci));
    await page.screenshot({ path: `tests/.shots/1307-g3-tastiera-${id}.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
});
