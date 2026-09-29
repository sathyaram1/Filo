// Esplorazione del giro 6: cosa succede dopo un Alt+S vero sulla scheda normale.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = (t) => `<!doctype html><html><head><title>${t}</title></head><body><p>${'Testo della pagina. '.repeat(40)}</p></body></html>`;

test('traccia Alt+S vero', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA('Prima'));
  const url = testServer.html(PAGINA('Da salvare'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const stato0 = await app.evaluate(({ BrowserWindow }) => {
    const ws = BrowserWindow.getAllWindows().map((w) => ({ id: w.id, tabs: !!w._filoTabs, inc: !!w._filoIncognito, url: w.webContents.getURL().slice(0, 40) }));
    const f = BrowserWindow.getFocusedWindow();
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return { ws, focused: f ? f.id : null, active: t.url };
  });
  console.log('PRIMA', JSON.stringify(stato0));
  await page.evaluate(() => {
    window.__log = [];
    const mo = new MutationObserver(() => { if (document.querySelector('.sn-save-confirm')) window.__log.push('pill ' + performance.now()); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  });
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__tr = [];
    const orig = globalThis.__filoShortcuts.dispatch;
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.on('before-input-event', (_e, i) => globalThis.__tr.push('bie ' + i.type + ' ' + i.key + ' alt=' + i.alt));
    t.view.webContents.on('ipc-message', (_e, ch, ...a) => globalThis.__tr.push('ipc ' + ch + ' ' + JSON.stringify(a).slice(0, 200)));
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['alt'] });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['alt'] });
  });
  await new Promise((r) => setTimeout(r, 6000));
  const dopo = await app.evaluate(async ({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const saved = (await globalThis.SN_STORAGE.getRaw('savedPages', [])).filter((p) => p.url === u).map((p) => ({ id: p.id, th: (p.thumbnail || '').slice(0, 30) }));
    return { tabs: w._filoTabs.tabs.map((t) => t.url), saved, tr: globalThis.__tr };
  }, url);
  console.log('DOPO', JSON.stringify(dopo));
  let log = null;
  try { log = await page.evaluate(() => window.__log); } catch (e) { log = 'pagina chiusa: ' + e.message.slice(0, 80); }
  console.log('PILL', JSON.stringify(log));
  expect(true).toBe(true);
});
