import { test, expect } from '../../fixtures/electron.mjs';
const CAMPO = '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="50"></textarea></body></html>';
const BLOCCA = "<script>window.addEventListener('contextmenu', (e) => e.preventDefault(), true);</script></body>";
test('sonda', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, CAMPO.replace('</body>', BLOCCA), { pubblico: true });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes('sito-pubblico'));
    const wc = tab.view.webContents;
    globalThis.__log = [];
    wc.on('input-event', (_e, i) => { if (i.type !== 'mouseMove') globalThis.__log.push('IE ' + i.type + ' ' + (i.key||'') + ' ' + JSON.stringify(i.modifiers||[])); });
    wc.on('before-input-event', (_e, i) => globalThis.__log.push('BIE ' + i.type + ' ' + i.key + ' shift=' + i.shift));
    wc.on('context-menu', (_e, p) => globalThis.__log.push('CM ' + (p.frame && p.frame.url)));
  });
  await page.locator('#ta').click();
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(500);
  await page.keyboard.press('ContextMenu');
  await page.waitForTimeout(500);
  await page.touchscreen?.tap?.(50, 50).catch(() => {});
  console.log((await app.evaluate(() => globalThis.__log)).join('\n'));
});
