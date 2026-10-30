import { test, expect } from '../../fixtures/electron.mjs';

test.use({ accoglienzaFatta: false });

const homes = (app) => app.windows().filter((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });

test('tolta la carta dei Crediti, la riapertura non lampeggia', async ({ app }) => {
  test.setTimeout(120_000);
  await expect.poll(() => homes(app).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const page = homes(app)[0];
  const cr = page.locator('#accade .dash-carta[data-chiave="crediti"]');
  await expect(cr).toBeVisible({ timeout: 15_000 });
  await cr.click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(page.locator('#tieni .dash-carta[data-chiave="editor"]')).toBeVisible();
  await page.evaluate(() => {
    window.__campioni = [];
    sessionStorage.setItem('x', '1');
  });
  await page.addInitScript?.(() => {});
  await page.reload();
  const campioni = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    const s = await page.evaluate(() => {
      const t = document.querySelector('#tieni');
      return t ? `${t.hidden ? 'H' : 'V'}${t.children.length}` : '-';
    }).catch(() => '!');
    campioni.push(`${Date.now() - t0}:${s}`);
    await page.waitForTimeout(30);
  }
  console.log(campioni.join(' '));
});
