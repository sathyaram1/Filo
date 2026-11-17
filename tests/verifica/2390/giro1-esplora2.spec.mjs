// #2390 giro 1 — prove esplorative del verificatore (menu).

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

async function vociMenu(app) {
  let testo = '';
  await expect.poll(async () => {
    for (const w of app.windows()) {
      let u = '';
      try { u = w.url(); } catch (_) { continue; }
      if (!u.startsWith('data:text/html')) continue;
      try { testo = (await w.locator('.menu').allInnerTexts()).join('|'); } catch (_) {}
      if (testo) return true;
    }
    return false;
  }, { timeout: 5_000 }).toBe(true);
  return testo;
}

test('menu dell\'avviso nell\'angolo, con un sito di provenienza', async ({ app, shell, avvisi, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  await shell.evaluate(() => window.filoNotify('Avviso da un sito', {
    durationSec: 0, indirizzo: 'https://esempio.it/pagina', actions: [{ label: 'Riprova', onClick() {} }],
  }));
  const vista = await avvisi();
  const carta = vista.locator('.shell-notif.show', { hasText: 'Avviso da un sito' });
  await expect(carta).toBeVisible();
  await carta.click({ button: 'right' });
  console.log('MENU ANGOLO:', await vociMenu(app));
});

test('menu della carta volata nella home, con un sito di provenienza', async ({ app, shell }) => {
  const home = await homePage(app);
  await shell.evaluate(() => window.filoNotify('Avviso da un sito', {
    durationSec: 1, indirizzo: 'https://esempio.it/pagina', actions: [{ label: 'Riprova', onClick() {} }],
  }));
  const carta = home.locator('#accade > .dash-carta[data-tipo="cornice"]');
  await expect(carta).toHaveCount(1, { timeout: 8_000 });
  await carta.click({ button: 'right' });
  console.log('MENU COLONNA:', (await home.locator('.dash-menu').allInnerTexts()).join('|'));
});
