// Esplorazione del verificatore (#1054 giro 1): voci, posizione, zoom, riquadri, latenza.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function apri(openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

async function voci(page) {
  return menuDi(page).voci.evaluateAll((els) => els.map((e) => e.textContent.trim().slice(0, 40)));
}

const HTML = `<!doctype html><body style="margin:0;font:16px sans-serif;height:2000px">
  <p id="t" style="position:absolute;left:40px;top:40px">Parola selezionabile qui</p>
  <a id="l" href="https://example.com/x" style="position:absolute;left:40px;top:100px">collegamento</a>
  <input id="c" value="testo campo" style="position:absolute;left:40px;top:160px;width:300px">
  <img id="i" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" style="position:absolute;left:40px;top:220px;width:80px;height:80px">
</body>`;

for (const acceso of [false, true]) {
  test.describe(`strato ${acceso ? 'acceso' : 'spento'}`, () => {
    test.use({ stratoDelMenu: acceso });

    test('voci e latenza', async ({ app, openTab, testServer }) => {
      test.setTimeout(90_000);
      if (acceso) { await paginaDelloStrato(app); await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true); }
      const page = await apri(openTab, testServer, HTML);
      const out = {};
      const tempi = [];
      for (const [nome, sel] of [['testo', '#t'], ['link', '#l'], ['campo', '#c'], ['img', '#i'], ['vuoto', 'body']]) {
        if (nome === 'testo') await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('t').firstChild); getSelection().removeAllRanges(); getSelection().addRange(r); });
        const t0 = Date.now();
        if (sel === 'body') await page.mouse.click(500, 500, { button: 'right' });
        else await page.locator(sel).click({ button: 'right' });
        await expect(menuDi(page).principale).toBeVisible();
        tempi.push(Date.now() - t0);
        await pausa(400);
        out[nome] = await voci(page);
        await page.keyboard.press('Escape');
        await expect(menuDi(page).principale).toHaveCount(0);
        await page.evaluate(() => getSelection().removeAllRanges());
      }
      console.log(`VOCI ${acceso}`, JSON.stringify(out, null, 1));
      console.log(`TEMPI ${acceso}`, JSON.stringify(tempi));
    });
  });
}
