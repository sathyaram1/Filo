import { test, expect } from '../../fixtures/electron.mjs';

test.use({ hostInPiu: ['filo-843.test'] });

test('esplora aspetto', async ({ app, openTab, testServer }) => {
  for (const tema of ['light', 'dark']) {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t, blocklist: ['münchen.de'] }); }, tema);
    const altro = await openTab('filo://options/altro.html');
    const casella = altro.locator('#blocklist');
    await expect(casella).not.toHaveValue('', { timeout: 8000 });
    await casella.click();
    await altro.keyboard.press('End');
    await altro.keyboard.type('\nfaceb\n<b>x</b>');
    await altro.locator('#h-blocklist').click();
    await altro.locator('#blocklist').scrollIntoViewIfNeeded();
    await altro.screenshot({ path: `tests/.shots/843-altro-${tema}.png` });
  }
  const page = await openTab(testServer.html('<p id="t" style="padding:40px">x</p>').replace('127.0.0.1', 'filo-843.test'));
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#t').click({ button: 'right' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/843-menu-dark.png' });
});
