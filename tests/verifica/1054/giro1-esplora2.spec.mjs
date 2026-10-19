// Esplorazione del verificatore (#1054 giro 1): le azioni delle voci nello strato, a confronto con quelle di oggi.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function apri(openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const HTML = `<!doctype html><body style="margin:0;font:16px sans-serif;height:2000px">
  <p id="t" style="position:absolute;left:40px;top:40px">Parola selezionabile qui</p>
  <a id="l" href="https://example.com/x" style="position:absolute;left:40px;top:100px">collegamento</a>
  <input id="c" value="testo campo" style="position:absolute;left:40px;top:160px;width:300px">
</body>`;

const leggi = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const scrivi = (app, t) => app.evaluate(({ clipboard }, x) => clipboard.writeText(x), t);

for (const acceso of [false, true]) {
  test.describe(`strato ${acceso ? 'acceso' : 'spento'}`, () => {
    test.use({ stratoDelMenu: acceso });

    test('copia, copia URL, taglia, seleziona', async ({ app, openTab, testServer, shell }) => {
      test.setTimeout(90_000);
      if (acceso) { await paginaDelloStrato(app); await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true); }
      const page = await apri(openTab, testServer, HTML);
      const esiti = {};
      // Copia di una selezione
      await scrivi(app, 'vecchio');
      await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('t').firstChild); getSelection().removeAllRanges(); getSelection().addRange(r); });
      await page.locator('#t').click({ button: 'right' });
      await menuDi(page).voce('Copia').click();
      await pausa(800);
      esiti.copia = await leggi(app);
      esiti.selezioneDopo = await page.evaluate(() => String(getSelection()));
      // Copia URL
      await page.locator('#l').click({ button: 'right' });
      await menuDi(page).voce('Copia URL').click();
      await pausa(800);
      esiti.copiaUrl = await leggi(app);
      // Campo con selezione: voci
      await page.locator('#c').click();
      await page.keyboard.press('Control+a');
      await page.locator('#c').click({ button: 'right' });
      await expect(menuDi(page).principale).toBeVisible();
      await pausa(400);
      esiti.vociCampoSel = await menuDi(page).principale.evaluate((e) => e.innerText.split('\n').filter(Boolean));
      esiti.fuocoPrima = await page.evaluate(() => document.activeElement && document.activeElement.id);
      const taglia = menuDi(page).voce('Taglia');
      if (await taglia.count()) {
        await taglia.click();
        await pausa(800);
        esiti.taglia = await leggi(app);
        esiti.campoDopoTaglia = await page.locator('#c').inputValue();
      } else {
        await page.keyboard.press('Escape');
      }
      // Apri in nuova tab
      const prima = await shell.evaluate(() => document.querySelectorAll('.tab').length);
      await page.locator('#l').click({ button: 'right' });
      await menuDi(page).voce('Apri in nuova tab').click();
      await pausa(1500);
      esiti.schede = (await shell.evaluate(() => document.querySelectorAll('.tab').length)) - prima;
      console.log(`ESITI ${acceso}`, JSON.stringify(esiti, null, 1));
    });
  });
}
