import { test, expect } from '../../fixtures/electron.mjs';
const CAMPO = '<!doctype html><html><body style="padding:40px"><button id="ok">Accetta</button><textarea id="ta" rows="5" cols="50"></textarea></body></html>';
test('eventi', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html(CAMPO).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab,
    `<!doctype html><html><body style="margin:0;padding:12px"><button id="ospite">Leggi</button><textarea id="tm"></textarea><iframe id="embed" src="${dentro}" width="640" height="460"></iframe></body></html>`);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes('127.0.0.1'));
    const wc = tab.view.webContents;
    globalThis.__log = [];
    wc.on('input-event', (_e, i) => { if (i.type === 'mouseDown' || i.type === 'keyDown') __log.push('input ' + i.type + ' ' + (i.button || i.key || '')); });
    wc.on('context-menu', (_e, p) => __log.push('ctx frame=' + (p.frame && p.frame.frameTreeNodeId) + ' origin=' + (p.frame && p.frame.origin) + ' main=' + wc.mainFrame.frameTreeNodeId));
    wc.on('before-input-event', (_e, i) => { if (i.type === 'keyDown') __log.push('before ' + i.key); });
  });
  const frame = page.frames().find((f) => f.url().includes('blocked.test'));
  const passo = async (nome, fn) => { await fn(); await page.waitForTimeout(600); const l = await app.evaluate(() => { const x = __log.slice(); __log.length = 0; return x; }); console.log('PASSO', nome, JSON.stringify(l)); await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(300); await app.evaluate(() => { __log.length = 0; }); };
  await passo('clic sx pagina', () => page.locator('#ospite').click());
  await passo('clic sx riquadro', () => frame.locator('#ok').click());
  await passo('tasto riquadro', async () => { await frame.locator('#ta').click(); await app.evaluate(() => { __log.length = 0; }); await page.keyboard.press('a'); });
  await passo('dx pagina', () => page.locator('#tm').click({ button: 'right' }));
  await passo('dx riquadro', () => frame.locator('#ta').click({ button: 'right' }));
  await passo('finto pagina', () => page.evaluate(() => document.getElementById('tm').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 50 }))));
  await passo('finto riquadro', () => frame.evaluate(() => document.getElementById('ta').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }))));
});
