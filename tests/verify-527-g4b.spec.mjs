import { test, expect } from './fixtures/electron.mjs';

test('sonda: cosa arriva al main quando si preme davvero Alt+1', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<html><body><h1>uno</h1></body></html>');
  const seconda = await testServer.openReady(openTab, '<html><body><input id="c"></body></html>');

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w.isDestroyed());
    const t = win._filoTabs;
    const attiva = t.tabs.find((x) => x.id === t.activeId);
    globalThis.__visti = [];
    attiva.view.webContents.on('before-input-event', (_e, input) => {
      globalThis.__visti.push({ type: input.type, key: input.key, code: input.code, alt: input.alt, control: input.control, meta: input.meta, shift: input.shift });
    });
  });

  await seconda.click('#c');
  await seconda.keyboard.press('Alt+1');
  await new Promise((r) => setTimeout(r, 500));

  const visti = await app.evaluate(() => globalThis.__visti);
  console.log('EVENTI:', JSON.stringify(visti));
  expect(visti.length).toBeGreaterThan(0);
});
