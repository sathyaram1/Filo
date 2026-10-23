// Verifica #814.15 giro 1: «Chiudi» dal tasto destro su un avviso della pagina, porte in più rispetto alla suite.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PAGE = `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif;height:100vh">
  <h1>Pagina con un collegamento</h1>
  <a id="link" href="https://example.com/articolo">Un collegamento di prova</a>
</body></html>`;

async function impostaDurata(shell, d) {
  await shell.evaluate((x) => window.filoShell.message({
    type: 'update_settings',
    settings: { notifications: { durationSec: x, soundEnabled: false, sound: 'default' } },
  }), d);
}

async function copiaUrl(page) {
  const menu = menuDi(page).locator('.sn-menu');
  for (let i = 0; i < 6; i++) {
    await page.locator('#link').click({ button: 'right', position: { x: 8, y: 8 } });
    const voce = menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' });
    try {
      await voce.first().waitFor({ state: 'visible', timeout: 1500 });
      await voce.first().click();
      await expect(menu).toHaveCount(0);
      return;
    } catch (_) { await page.waitForTimeout(200); }
  }
  throw new Error('voce «Copia URL» non raggiungibile');
}

async function destroSopra(page, locator) {
  await expect(locator).toHaveClass(/sn-toast-visible|show/);
  await page.waitForTimeout(250);
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
}

test('due avvisi nella pila: «Chiudi» sul primo lo chiude e lascia l’altro, poi chiude anche l’altro', async ({ shell, openTab, testServer }) => {
  await impostaDurata(shell, 0);
  const page = await testServer.openReady(openTab, PAGE);
  await page.waitForTimeout(300);
  await copiaUrl(page);
  await copiaUrl(page);
  const avvisi = page.locator('.sn-toast');
  await expect.poll(() => avvisi.count()).toBeGreaterThan(0);
  const n = await avvisi.count();
  for (let k = n; k > 0; k--) {
    await destroSopra(page, avvisi.last());
    const voci = menuDi(page).locator('.sn-menu .sn-menu-item');
    await expect(voci).toHaveText(['Chiudi']);
    await voci.first().click();
    await expect(avvisi).toHaveCount(k - 1, { timeout: 1500 });
  }
});

test('«Chiudi» scelto con la tastiera chiude l’avviso', async ({ shell, openTab, testServer }) => {
  await impostaDurata(shell, 0);
  const page = await testServer.openReady(openTab, PAGE);
  await page.waitForTimeout(300);
  await copiaUrl(page);
  const avviso = page.locator('.sn-toast');
  await destroSopra(page, avviso);
  const voci = menuDi(page).locator('.sn-menu .sn-menu-item');
  await expect(voci).toHaveText(['Chiudi']);
  await voci.first().focus();
  await voci.first().press('Enter');
  await expect(avviso).toHaveCount(0, { timeout: 1500 });
});

test('apri e chiudi in fretta: tasto destro, Esc, tasto destro, «Chiudi» chiude l’avviso a durata normale', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  await page.waitForTimeout(300);
  await copiaUrl(page);
  const avviso = page.locator('.sn-toast');
  await destroSopra(page, avviso);
  const voci = menuDi(page).locator('.sn-menu .sn-menu-item');
  await expect(voci).toHaveText(['Chiudi']);
  await page.keyboard.press('Escape');
  await expect(voci).toHaveCount(0);
  await destroSopra(page, avviso);
  await expect(voci).toHaveText(['Chiudi']);
  await voci.first().click();
  await expect(avviso).toHaveCount(0, { timeout: 1500 });
});
