// Esplorazione della verifica #1509.1, giro 1: si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi, clicca, conta, paginaDelloStrato, nelloStrato } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SPIA = `<script>
  window.__letti = []; window.__clic = 0; window.__over = 0;
  const leggi = () => { try { const s = String(getSelection()); if (s) window.__letti.push(s); } catch (_) {} };
  document.addEventListener('selectionchange', leggi, true);
  for (const t of ['copy', 'cut', 'keyup', 'mouseup', 'input']) window.addEventListener(t, leggi, true);
  setInterval(leggi, 50);
</script>`;
const pagina = (corpo = '', stile = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif;${stile}">`
  + `<p style="font-size:20px">Il <span id="parola">gatto</span> dorme sul <span id="altra">divano</span>.</p>${corpo}${SPIA}</body></html>`;

async function modelloFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash', [C.ACTIONS.EDIT_TEXT]: 'deepseek-flash', [C.ACTIONS.FOLLOWUP || 'followup']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      complete: async () => ({ text: 'Testo riscritto per bene.', usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta('The cat sleeps.'); return { text: 'The cat sleeps.', usage: {} }; },
    };
  });
}
const comando = (app, nome) => app.evaluate(({ BrowserWindow }, c) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  globalThis.__filoShortcuts.dispatch(c, win);
}, nome);

// Info sul main: id della scheda, dello strato, chi ha il fuoco, zoom.
const info = (app, url) => app.evaluate(({ BrowserWindow, webContents }, u) => {
  for (const win of BrowserWindow.getAllWindows()) {
    const tm = win._filoTabs;
    const tab = (tm?.tabs || []).find((t) => { try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; } });
    if (!tab) continue;
    const s = tm.riquadri?.strati?.get(tab.view.webContents);
    const f = webContents.getFocusedWebContents();
    return {
      tab: tab.view.webContents.id, strato: s ? s.vista.webContents.id : null,
      fuoco: f ? f.id : null, fuocoUrl: f ? f.getURL() : null,
      zoomTab: tab.view.webContents.getZoomFactor(), zoomStrato: s ? s.vista.webContents.getZoomFactor() : null,
      boundsTab: tab.view.getBounds(), boundsStrato: s ? s.vista.getBounds() : null,
      stratoVisibile: s ? s.vista.getVisible() : null,
      schede: tm.tabs.length,
    };
  }
  return null;
}, url);

const tastoAllo = (app, url, keyCode, modifiers = []) => app.evaluate(({ BrowserWindow }, { u, k, m }) => {
  for (const win of BrowserWindow.getAllWindows()) {
    const tm = win._filoTabs;
    const tab = (tm?.tabs || []).find((t) => { try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; } });
    const s = tab && tm.riquadri?.strati?.get(tab.view.webContents);
    if (!s) continue;
    s.vista.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m });
    s.vista.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m });
    return true;
  }
  return false;
}, { u: url, k: keyCode, m: modifiers });

test('E1 feedback dal menu vero, poi Ctrl+T e Ctrl+W scritti nel riquadro', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina());
  await p.locator('#parola').click({ button: 'right' });
  await expect(menuDi(p).principale).toBeVisible({ timeout: 10_000 });
  const t0 = Date.now();
  await menuDi(p).voce('Invia feedback').click();
  await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 15_000 }).not.toBeNull();
  console.log('E1 apertura feedback a freddo ms', Date.now() - t0);
  const strato = await scrivi(app, p, '.sn-fb-text', 'segreto-menu-1509');
  await strato.keyboard.press('ControlOrMeta+A');
  await p.waitForTimeout(300);
  expect(await p.evaluate(() => window.__letti.join('|'))).not.toContain('segreto');
  const i0 = await info(app, p.url());
  console.log('E1 info', JSON.stringify(i0));
  await tastoAllo(app, p.url(), 'T', ['control']);
  await expect.poll(async () => (await info(app, p.url()))?.schede ?? 99, { timeout: 5000 }).toBe(i0.schede + 1);
});

test('E2 risposta aperta: doppio clic e tasto destro su un\'altra parola della pagina, poi un campo della pagina prende la tastiera', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<input id="campo" style="display:block;margin-top:300px;width:300px">'));
  await p.locator('#parola').dblclick();
  const t0 = Date.now();
  await comando(app, 'translate-selection');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  console.log('E2 apertura risposta a freddo ms', Date.now() - t0);
  const strato = await paginaDelloStrato(app, p);
  const a = await p.locator('#altra').boundingBox();
  const pop = await statoDi(app, p, '.sn-popup');
  console.log('E2 popup', JSON.stringify(pop), 'altra', JSON.stringify(a));
  await strato.mouse.dblclick(a.x + a.width / 2, a.y + a.height / 2);
  await expect.poll(() => p.evaluate(() => String(getSelection()).trim())).toBe('divano');
  await strato.mouse.click(a.x + a.width / 2, a.y + a.height / 2, { button: 'right' });
  await expect(menuDi(p).principale).toBeVisible({ timeout: 5000 });
  await p.keyboard.press('Escape').catch(() => {});
  await expect.poll(() => menuDi(p).principale.isVisible()).toBe(false).catch(() => {});
  const c = await p.locator('#campo').boundingBox();
  await strato.mouse.click(c.x + 10, c.y + c.height / 2);
  await expect.poll(() => p.evaluate(() => document.activeElement && document.activeElement.id)).toBe('campo');
  const i = await info(app, p.url());
  console.log('E2 fuoco', JSON.stringify(i));
  expect(i.fuoco).toBe(i.tab);
});

test('E3 la foto del feedback nello strato è la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina('', 'background:#00ff00'));
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 15_000 }).not.toBeNull();
  const px = await nelloStrato(app, p, async () => {
    const r = await chrome.runtime.sendMessage({ type: globalThis.SN_MSG.MSG.CAPTURE_VISIBLE_TAB });
    if (!r || !r.dataUrl) return { errore: JSON.stringify(r) };
    const img = new Image();
    await new Promise((ok) => { img.onload = ok; img.onerror = ok; img.src = r.dataUrl; });
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
    return { w: img.naturalWidth, h: img.naturalHeight, px: Array.from(cx.getImageData(5, img.naturalHeight - 5, 1, 1).data) };
  });
  console.log('E3 foto', JSON.stringify(px));
  expect(px.px.slice(0, 3)).toEqual([0, 255, 0]);
});

test('E4 zoom della scheda 150%: la risposta cresce come la pagina?', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina());
  await app.evaluate(({ BrowserWindow }, u) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tab = (win._filoTabs?.tabs || []).find((t) => t.view?.webContents?.getURL() === u);
      if (tab) tab.view.webContents.setZoomFactor(1.5);
    }
  }, p.url());
  await p.waitForTimeout(300);
  await p.locator('#parola').dblclick();
  await comando(app, 'translate-selection');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  const pop = await statoDi(app, p, '.sn-popup');
  const i = await info(app, p.url());
  const parola = await p.locator('#parola').boundingBox();
  console.log('E4', JSON.stringify({ pop, zoomTab: i.zoomTab, zoomStrato: i.zoomStrato, parola }));
  expect(i.zoomStrato).toBe(i.zoomTab);
});

test('E5 cambio scheda e ritorno, navigazione, finestra ridimensionata', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina());
  await p.locator('#parola').dblclick();
  await comando(app, 'translate-selection');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  const q = await testServer.openReady(openTab, `<body style="margin:0"><button id="b" style="width:100%;height:100vh" onclick="window.__c=(window.__c||0)+1">x</button></body>`);
  const iq = await info(app, p.url());
  console.log('E5 dopo cambio', JSON.stringify(iq));
  expect(iq.stratoVisibile).toBe(false);
  await q.mouse.click(300, 300);
  await expect.poll(() => q.evaluate(() => window.__c || 0)).toBe(1);
  await q.bringToFront();
  await app.evaluate(({ BrowserWindow }, u) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tm = win._filoTabs;
      const tab = (tm?.tabs || []).find((t) => t.view?.webContents?.getURL() === u);
      if (tab) tm.activateTab ? tm.activateTab(tab.id) : null;
    }
  }, p.url());
  await p.waitForTimeout(500);
  const ip = await info(app, p.url());
  console.log('E5 ritorno', JSON.stringify(ip));
  expect(await conta(app, p, '.sn-popup')).toBe(1);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); const b = w.getBounds(); w.setBounds({ ...b, width: b.width - 200, height: b.height - 100 }); });
  await p.waitForTimeout(800);
  const ir = await info(app, p.url());
  console.log('E5 ridimensionata', JSON.stringify(ir));
  expect(ir.boundsStrato).toEqual(ir.boundsTab);
  await p.goto(testServer.html(pagina()));
  await p.waitForTimeout(800);
  expect(await conta(app, p, '.sn-popup')).toBe(0);
});

test('E6 tasto destro nel campo del feedback nello strato: il menu di Filo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina());
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 15_000 }).not.toBeNull();
  const strato = await scrivi(app, p, '.sn-fb-text', 'una prova');
  const s = await statoDi(app, p, '.sn-fb-text');
  await strato.mouse.click(s.x + 20, s.y + 10, { button: 'right' });
  await p.waitForTimeout(1500);
  const menuPagine = app.windows().map((w) => w.url());
  console.log('E6 finestre', JSON.stringify(menuPagine));
  const m = menuDi(strato);
  const vis = await m.principale.isVisible().catch(() => false);
  const visP = await menuDi(p).principale.isVisible().catch(() => false);
  console.log('E6 menu visibile strato/pagina', vis, visP);
  expect(vis || visP).toBe(true);
});
