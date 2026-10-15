import { test, expect } from '../../fixtures/electron.mjs';

test('esplora: col controllo vero, valido azzurro, inesistente rosso, emoji e html', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });
  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('newtab') || url.includes('dashboard')) {
        wc.send('filo:broadcast', { type: 'settings_updated', settings: { terminal: { enabled: true, shell: 'bash' } } });
      }
    }
  });
  await expect.poll(() => page.evaluate(() => window.SN_DASH_TERMINALE.isEnabled()), { timeout: 8_000 }).toBe(true);
  const r = await page.evaluate(() => window.filo.shellWhich({ command: 'ls' }));
  console.log('which ls', JSON.stringify(r));
  await input.fill('/ls -la');
  await expect(input).toHaveClass(/is-cmd-shell/, { timeout: 15_000 });
  await input.fill('/zzqqxx');
  await expect(input).toHaveClass(/is-cmd-unknown/, { timeout: 15_000 });
  await input.fill('/<b>x</b>');
  await page.waitForTimeout(1500);
  console.log('html', await input.getAttribute('class'));
  await input.fill('/🙂');
  await page.waitForTimeout(1500);
  console.log('emoji', await input.getAttribute('class'));
  await input.fill('/   ');
  await page.waitForTimeout(800);
  console.log('spazi', await input.getAttribute('class'));
  await input.fill('/ls');
  await expect(input).toHaveClass(/is-cmd-shell/, { timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/1176-ls.png' });
});
