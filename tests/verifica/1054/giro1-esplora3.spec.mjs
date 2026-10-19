// Esplorazione del verificatore (#1054 giro 1): sottomenu, riquadri di altri siti, zoom, clic in fretta, angoli.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function apri(openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}
const scrivi = (app, t) => app.evaluate(({ clipboard }, x) => clipboard.writeText(x), t);
const zoom = (app, page, z) => app.evaluate(({ BrowserWindow }, { u, z }) => {
  for (const w of BrowserWindow.getAllWindows()) for (const t of (w._filoTabs?.tabs || [])) {
    if (t.view?.webContents?.getURL() === u) t.view.webContents.setZoomFactor(z);
  }
}, { u: page.url(), z });

test.describe('strato acceso', () => {
  test.use({ stratoDelMenu: true });

  test('sottomenu, iframe, zoom, fretta, angolo', async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    await paginaDelloStrato(app);
    await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
    const fuori = testServer.html(`<!doctype html><body style="margin:0"><input id="f" value="ab" style="position:absolute;left:10px;top:10px;width:200px"></body>`, { pubblico: true });
    const page = await apri(openTab, testServer, `<!doctype html><body style="margin:0;font:16px sans-serif;height:2000px">
      <input id="c" value="testo campo" style="position:absolute;left:40px;top:40px;width:300px">
      <iframe id="fr" src="${fuori}" style="position:absolute;left:400px;top:200px;width:300px;height:120px;border:0"></iframe>
    </body>`);
    const esiti = {};
    const menu = menuDi(page);

    // a) sottomenu Modifica
    await page.locator('#c').click({ button: 'right' });
    await expect(menu.principale).toBeVisible();
    const sub = menu.voce('Modifica');
    esiti.haModifica = await sub.count();
    if (esiti.haModifica) {
      await sub.first().hover();
      await pausa(600);
      esiti.sottomenu = await menu.sottomenu.count();
      esiti.vociSub = esiti.sottomenu ? await menu.sottomenu.first().evaluate((e) => e.innerText.split('\n').filter(Boolean).slice(0, 12)) : null;
    }
    await page.keyboard.press('Escape');
    await expect(menu.principale).toHaveCount(0);

    // b) iframe di un altro sito
    const fr = page.frames().find((f) => f.url().startsWith('http://sito-pubblico.test'));
    await fr.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 }).catch(() => {});
    await scrivi(app, 'DAL MENU');
    await page.mouse.click(400 + 10 + 150, 200 + 10 + 8, { button: 'right' });
    await expect(menu.principale).toBeVisible();
    const s1 = await statoDelloStrato(app);
    const b1 = await menu.principale.boundingBox();
    esiti.iframe = { punto: s1.punto, menu: b1 };
    await menu.locator('.sn-menu-paste-main').click();
    await pausa(800);
    esiti.iframeValore = await fr.locator('#f').inputValue();
    esiti.iframeFuoco = await fr.evaluate(() => document.hasFocus() && document.activeElement && document.activeElement.id);

    // c) zoom 150%
    await page.mouse.click(600, 600, { button: 'right' });
    await expect(menu.principale).toBeVisible();
    const b100 = await menu.principale.boundingBox();
    await page.keyboard.press('Escape');
    await zoom(app, page, 1.5);
    await pausa(500);
    const r = await page.locator('#c').boundingBox();
    await page.locator('#c').click({ button: 'right', position: { x: 20, y: 5 } });
    await expect(menu.principale).toBeVisible();
    const b150 = await menu.principale.boundingBox();
    const s2 = await statoDelloStrato(app);
    const rc = await page.evaluate(() => { const b = document.getElementById('c').getBoundingClientRect(); return { x: b.left, y: b.top }; });
    esiti.zoom = { b100: { w: b100.width, h: b100.height }, b150, punto: s2.punto, campoCssPx: rc, atteso: { x: (rc.x + 20) * 1.5, y: (rc.y + 5) * 1.5 }, pwBox: r };
    await page.keyboard.press('Escape');
    await zoom(app, page, 1);
    await pausa(300);

    // d) due tasti destri in fretta
    await page.mouse.click(100, 400, { button: 'right' });
    await page.mouse.click(500, 500, { button: 'right' });
    await pausa(1500);
    esiti.fretta = { menu: await menu.principale.count(), box: await menu.principale.first().boundingBox().catch(() => null), punto: (await statoDelloStrato(app)).punto };
    await page.keyboard.press('Escape');
    await pausa(300);

    // e) angolo in basso a destra
    const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    await page.mouse.click(vp.w - 5, vp.h - 5, { button: 'right' });
    await expect(menu.principale).toBeVisible();
    const s3 = await statoDelloStrato(app);
    esiti.angolo = { vp, area: s3.area, box: await menu.principale.boundingBox() };
    await page.keyboard.press('Escape');

    // f) il campo, poi tasto Menu della tastiera
    await page.locator('#c').click();
    await page.keyboard.press('ContextMenu');
    await pausa(1200);
    esiti.tastoMenu = { aperto: (await statoDelloStrato(app)).aperto, voci: await menu.principale.count() };
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+F10');
    await pausa(1200);
    esiti.shiftF10 = { aperto: (await statoDelloStrato(app)).aperto, voci: await menu.principale.count() };
    console.log('ESITI3', JSON.stringify(esiti, null, 1));
  });
});

test.describe('strato spento', () => {
  test('tasto Menu della tastiera', async ({ openTab, testServer }) => {
    const page = await apri(openTab, testServer, '<!doctype html><body><input id="c" value="x" style="margin:40px"></body>');
    await page.locator('#c').click();
    await page.keyboard.press('ContextMenu');
    await pausa(1200);
    const a = await menuDi(page).principale.count();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+F10');
    await pausa(1200);
    console.log('SPENTO tasti', a, await menuDi(page).principale.count());
  });
});
