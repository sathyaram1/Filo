// #2390 giro 1, rilievo 2 — la carta volata nella home ha lo stesso tasto destro dell'avviso nell'angolo.

import { test, expect } from '../../fixtures/electron.mjs';

async function homePage(app) {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 8_000 });
  return page;
}

test('r2 avviso nato da un sito, volato nella home: il tasto destro apre ancora il sito, e «Chiudi» c\'è una volta sola', async ({ app, shell }) => {
  const home = await homePage(app);
  await shell.evaluate(() => window.filoNotify('Avviso da un sito', {
    durationSec: 1, indirizzo: 'https://esempio.it/pagina', actions: [{ label: 'Riprova', onClick() {} }],
  }));
  const carta = home.locator('#accade > .dash-carta[data-tipo="cornice"]');
  await expect(carta).toHaveCount(1, { timeout: 8_000 });
  await carta.click({ button: 'right' });
  const menu = home.locator('.dash-menu');
  await expect(menu.locator('.dash-menu-voce', { hasText: 'Riprova' })).toBeVisible();
  await expect(menu.locator('.dash-menu-voce', { hasText: 'esempio.it' })).toHaveCount(1);
  await expect(menu.locator('.dash-menu-voce', { hasText: /^\s*Chiudi/ })).toHaveCount(1);
});
