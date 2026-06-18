import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null, { timeout: 8_000 },
  );
  return win;
}

test('probe: cosa torna CAPTURE_VISIBLE_TAB', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const r = await page.evaluate(async () => {
    const { MSG } = window.SN_MSG;
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_VISIBLE_TAB });
      return { ok: res?.ok, hasDataUrl: !!res?.dataUrl, len: (res?.dataUrl||'').length, head: (res?.dataUrl||'').slice(0,40), error: res?.error };
    } catch (e) { return { threw: String(e) }; }
  });
  console.log('CAPTURE_VISIBLE_TAB =>', JSON.stringify(r));
});
