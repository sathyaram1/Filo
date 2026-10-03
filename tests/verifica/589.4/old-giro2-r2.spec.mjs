// #589.4 giro 2, rilievo 2 — una scheda passata sullo sfondo non svuota la cronologia appunti col gesto fatto quando era
// davanti (isolamento dei contesti rotto: il sito parla dal mondo del preload).

import { test, expect } from '../../fixtures/electron.mjs';

const PASSWORD = 'Pw-segreta-5894!';
const MONDO_CONTENT_SCRIPT = 999;

test('scheda di sfondo, dopo un clic fatto quando era davanti, non svuota la cronologia', async ({ app, shell, openTab, testServer }) => {
  const r = await shell.evaluate((text) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text } }), PASSWORD);
  expect(r).toEqual({ ok: true });
  const a = await testServer.openReady(openTab, '<!doctype html><html><body><button id="ok">Accetta</button></body></html>', { pubblico: true });
  await a.locator('#ok').click();
  await testServer.openReady(openTab, '<!doctype html><html><body>altra</body></html>');
  const esito = await app.evaluate(async ({ BrowserWindow }, mondo) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes('sito-pubblico.test'));
    return { davanti: win._filoTabs.activeId === tab.id, r: await tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code: "chrome.runtime.sendMessage({ type: 'clear_clipboard_history' })" }]) };
  }, MONDO_CONTENT_SCRIPT);
  expect(esito.davanti, 'la scheda del sito doveva essere sullo sfondo').toBe(false);
  const h = await shell.evaluate(() => window.filoShell.message({ type: 'get_clipboard_history' }));
  expect(JSON.stringify(h), 'la scheda di sfondo ha svuotato la cronologia').toContain(PASSWORD);
});
