// Esplorazione della verifica #2377 giro 1: incognito, lettera contesa, aspetto.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

function premi(app, passi, { incognito = false, box = false } = {}) {
  return app.evaluate(async ({ BrowserWindow }, { passi, incognito, box }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === incognito);
    const b = BrowserWindow.getAllWindows().find((x) => x.webContents.getTitle() === 'Lettere di Filo' && x.isVisible());
    const wc = box ? b.webContents : w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
    for (const p of passi) {
      if (p === 'tocco') {
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] });
        await new Promise((r) => setTimeout(r, 40));
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Control' });
        continue;
      }
      const [tipo, k] = p;
      if (tipo === 'attendi') { await new Promise((r) => setTimeout(r, k)); continue; }
      wc.sendInputEvent({ type: tipo === 'giu' ? 'keyDown' : 'keyUp', keyCode: k });
    }
  }, { passi, incognito, box });
}
const boxi = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((x) => x.webContents.getTitle() === 'Lettere di Filo' && x.isVisible())
  .map((x) => ({ incognito: !!(x.getParentWindow() && x.getParentWindow()._filoIncognito), b: x.getBounds(), p: x.getParentWindow() && x.getParentWindow().getContentBounds() })));
async function boxPagina(app) {
  for (const w of app.windows()) { try { if (await w.title() === 'Lettere di Filo' && await w.evaluate(() => document.querySelectorAll('.riga').length)) return w; } catch (_) {} }
  return null;
}

test('incognito: il box sta sulla finestra in incognito, e C apre la home lì', async ({ app, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const rq = process.mainModule.require;
    const W = rq(rq('node:path').join(process.cwd(), 'src/main/window.js'));
    const w = await W.createIncognitoWindow();
    if (w && w.focus) w.focus();
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && x._filoIncognito);
    return !!(w && w._filoTabs.tabs.length && w._filoTabs.activeId);
  }), { timeout: 15000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 1500));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && x._filoIncognito).focus());
  await premi(app, ['tocco', ['attendi', 80], 'tocco'], { incognito: true });
  await expect.poll(async () => (await boxi(app)).length, { timeout: 6000 }).toBe(1);
  console.log('BOX', JSON.stringify(await boxi(app)));
  expect((await boxi(app))[0].incognito).toBe(true);
  await premi(app, [['giu', 'Escape'], ['su', 'Escape']], { box: true });
  await expect.poll(async () => (await boxi(app)).length).toBe(0);
  const usate = await app.evaluate(async () => {
    const rq = process.mainModule.require;
    const S = rq(rq('node:path').join(process.cwd(), 'src/main/shim/storage.js'));
    return S.get('sn_doppio_ctrl_usate');
  });
  console.log('USATE', JSON.stringify(usate));
});

test('una lettera contesa: la D data all\'Editor, il Tema va fra quelle senza; il box chiaro e scuro', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await testServer.openReady(openTab, '<!doctype html><title>x</title><body style="background:#fff"><h1>Una pagina</h1></body>');
  await premi(app, ['tocco', ['attendi', 80], 'tocco']);
  await expect.poll(async () => (await boxi(app)).length, { timeout: 6000 }).toBe(1);
  const box = await boxPagina(app);
  await box.locator('.riga[data-id="app:editor"] .tasto').click();
  await box.keyboard.press('d');
  await expect(box.locator('.riga[data-id="app:editor"]')).toHaveAttribute('data-lettera', 'd');
  const tema = await box.locator('.riga[data-id="tema"]').getAttribute('data-lettera');
  console.log('TEMA DOPO', JSON.stringify(tema), 'righe', await box.locator('.riga').count());
  console.log('BOUNDS', JSON.stringify(await boxi(app)));
  await box.screenshot({ path: `${SHOTS}/v2377-box-conteso.png` });
  await box.locator('.riga[data-id="tema"]').hover();
  await box.waitForTimeout(300);
  await box.screenshot({ path: `${SHOTS}/v2377-box-hover.png` });
  // La chat: «lettere di serie» rimette tutto.
  const r = await app.evaluate(async () => {
    const P = globalThis.SN_PREFERENZE || globalThis.SN_PREFERENCES;
    return P ? Object.keys(P).slice(0, 20) : Object.keys(globalThis).filter((k) => /PREF/.test(k));
  });
  console.log('PREF API', JSON.stringify(r));
  await box.keyboard.press('Escape');
  // Lo screenshot di tutta la finestra col box sopra.
  await app.evaluate(async ({ BrowserWindow }) => { await globalThis.__filoHandlers.applySettingsUpdate({ theme: 'dark' }); });
  await premi(app, ['tocco', ['attendi', 80], 'tocco']);
  await expect.poll(async () => (await boxi(app)).length, { timeout: 6000 }).toBe(1);
  const box2 = await boxPagina(app);
  await box2.waitForTimeout(400);
  await box2.screenshot({ path: `${SHOTS}/v2377-box-scuro.png` });
});
