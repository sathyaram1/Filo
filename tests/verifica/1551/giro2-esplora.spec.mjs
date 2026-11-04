// #1551 giro 2: il tasto Invio della home resta scoperto dagli avvisi anche per le strade che il lavoro non nomina.
import { test, expect } from '../../fixtures/electron.mjs';
import { captureCompositeElectron } from '../../agent/driver.mjs';

const LUNGO = 'Il catalogo è pronto: 14 pagine, 3 offerte nuove';

const tabAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
  return tm.activeId;
});

async function paginaHome(app, escludi = []) {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab') && !escludi.includes(w); } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 8_000 });
  return page;
}

async function scarto(app, page) {
  const tasto = await page.locator('#sendBtn').evaluate((b) => { const r = b.getBoundingClientRect(); return { x: r.left, w: r.width }; });
  const win = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    const v = tm.avvisi && tm.avvisi.vista;
    return { scheda: tab.view.getBounds(), zoom: tab.view.webContents.getZoomFactor(), pila: v && v.getVisible() ? v.getBounds() : null };
  });
  if (!win.pila) return null;
  return Math.round(win.pila.x - (win.scheda.x + (tasto.x + tasto.w) * (win.zoom || 1)));
}

const larghezza = (page) => page.locator('#inputForm').evaluate((f) => Math.round(f.getBoundingClientRect().width));

test('avviso arrivato su un sito, poi si torna alla home: il tasto Invio è scoperto', async ({ app, shell, avvisi, testServer, openTab }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(1280, 840));
  const home = await paginaHome(app);
  const homeId = await tabAttiva(app);
  await openTab(testServer.html('<h1>sito</h1>'));
  await shell.evaluate((t) => window.filoNotify(t, { durationSec: 0 }), LUNGO);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), homeId);
  await expect.poll(() => scarto(app, home), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
});

test('avviso già a schermo, si apre una home nuova: il tasto Invio è scoperto', async ({ app, shell, avvisi }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(1280, 840));
  const prima = await paginaHome(app);
  await shell.evaluate((t) => window.filoNotify(t, { durationSec: 0 }), LUNGO);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const nuova = await paginaHome(app, [prima]);
  await expect.poll(() => scarto(app, nuova), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
});

test('finestra stretta mentre c\'è l\'avviso, poi riallargata: il tasto Invio è scoperto, e il campo torna largo alla chiusura', async ({ app, shell, avvisi }) => {
  const win = (w, h) => app.evaluate(({ BrowserWindow }, [a, b]) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(a, b), [w, h]);
  await win(1280, 840);
  const page = await paginaHome(app);
  const largo = await larghezza(page);
  await shell.evaluate((t) => window.filoNotify(t, { durationSec: 0 }), LUNGO);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await win(760, 640);
  await expect.poll(() => scarto(app, page), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
  await win(1280, 840);
  await expect.poll(() => scarto(app, page), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
  await vista.locator('.shell-notif.show .shell-notif-close').first().click();
  await expect.poll(() => larghezza(page), { timeout: 4000 }).toBe(largo);
});

test('un avviso che scade da solo restituisce la larghezza al campo', async ({ app, shell, avvisi }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(1280, 840));
  const page = await paginaHome(app);
  const largo = await larghezza(page);
  await shell.evaluate((t) => window.filoNotify(t, { durationSec: 2 }), LUNGO);
  await avvisi();
  await expect.poll(() => larghezza(page), { timeout: 3000 }).toBeLessThan(largo);
  await expect.poll(() => larghezza(page), { timeout: 10_000 }).toBe(largo);
});

for (const scala of [1.5, 2]) {
  test(`testo grande dalle Preferenze (${scala}) a 1280x840: tasto scoperto e campo non stretto oltre il dovuto`, async ({ app, shell, avvisi }) => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(1280, 840));
    let page = await paginaHome(app);
    await page.evaluate(async (s) => {
      const r = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...((r && r.settings) || {}), textScale: s } });
    }, scala);
    await page.reload();
    page = await paginaHome(app);
    await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe(String(scala));
    await page.waitForTimeout(300);
    const largo = await larghezza(page);
    await page.screenshot({ path: test.info().outputPath(`senza-${scala}.png`) });
    await shell.evaluate((t) => window.filoNotify(t, { durationSec: 0 }), LUNGO);
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
    await expect.poll(() => scarto(app, page), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
    const stretto = await larghezza(page);
    const s = await scarto(app, page);
    console.log(`SCALA ${scala}: campo ${largo} -> ${stretto}, scarto ${s}`);
    await captureCompositeElectron(app, test.info().outputPath(`scala-${scala}.png`));
    // Se il campo si è stretto, doveva stringersi solo fin dove serve.
    if (stretto < largo) expect(s).toBeLessThanOrEqual(60);
    await expect.poll(() => page.locator('#input').evaluate((t) => t.scrollHeight - t.clientHeight), { timeout: 3000 }).toBeLessThanOrEqual(1);
  });
}

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}: home 1280x840 e 900x700 con l'avviso del portachiavi`, async ({ app, shell, avvisi }, info) => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(1280, 840));
    let page = await paginaHome(app);
    await page.evaluate(async (t) => {
      const r = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...((r && r.settings) || {}), theme: t } });
    }, tema);
    await page.reload();
    page = await paginaHome(app);
    await shell.evaluate(() => window.filoNotify('Il portachiavi di sistema non risponde: l’accesso vale fino alla chiusura di Filo', { durationSec: 0, actions: [{ label: 'Capito', onClick() {} }] }));
    await avvisi();
    await page.locator('#input').fill('Cerca le offerte del catalogo');
    await page.waitForTimeout(600);
    await captureCompositeElectron(app, info.outputPath(`home-${tema}-1280.png`));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(900, 700));
    await page.waitForTimeout(600);
    await captureCompositeElectron(app, info.outputPath(`home-${tema}-900.png`));
    expect(await scarto(app, page)).toBeGreaterThanOrEqual(0);
  });
}
