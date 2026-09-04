import { test, expect } from './fixtures/electron.mjs';

const attivaIdx = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w.isDestroyed());
  const t = win._filoTabs;
  return { idx: t.tabs.findIndex((x) => x.id === t.activeId), n: t.tabs.length };
});

test('sonda: Alt+1 premuto davvero, dalla pagina attiva', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<html><body><input id="c"></body></html>');
  const prima = await attivaIdx(app);
  console.log('PRIMA:', JSON.stringify(prima));
  expect(prima.idx).toBeGreaterThan(0);

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w.isDestroyed());
    const t = win._filoTabs;
    const a = t.tabs.find((x) => x.id === t.activeId);
    globalThis.__visti = [];
    a.view.webContents.on('before-input-event', (_e, input) => {
      globalThis.__visti.push({ type: input.type, key: input.key, code: input.code, alt: input.alt, control: input.control, meta: input.meta, shift: input.shift });
    });
  });

  await page.click('#c');
  await page.keyboard.press('Alt+1');
  await new Promise((r) => setTimeout(r, 800));
  console.log('EVENTI:', JSON.stringify(await app.evaluate(() => globalThis.__visti)));
  console.log('DOPO:', JSON.stringify(await attivaIdx(app)));
});
