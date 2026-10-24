// Verifica #795.2 giro 1: «Chiudi» dal tasto destro su un avviso chiude l'avviso, per le porte che la suite non prova.

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

test('pagina web: apri il menu dell’avviso, Esc, riaprilo: «Chiudi» lo chiude', async ({ shell, openTab, testServer }) => {
  await impostaDurata(shell, 0);
  const page = await testServer.openReady(openTab, PAGE);
  await page.waitForTimeout(300);
  await copiaUrl(page);
  const avviso = page.locator('.sn-toast');
  await destroSopra(page, avviso);
  const voci = menuDi(page).locator('.sn-menu .sn-menu-item');
  await expect(voci).toHaveText(['Chiudi']);
  await page.keyboard.press('Escape');
  await expect(menuDi(page).locator('.sn-menu')).toHaveCount(0);
  await expect(avviso).toHaveCount(1);
  await destroSopra(page, avviso);
  await expect(voci).toHaveText(['Chiudi']);
  await voci.first().click();
  await expect(avviso).toHaveCount(0, { timeout: 1500 });
});

test('pagina web ingrandita al 150%: «Chiudi» dal menu dell’avviso lo chiude', async ({ app, shell, openTab, testServer }) => {
  await impostaDurata(shell, 0);
  const page = await testServer.openReady(openTab, PAGE);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.tabs.find((t) => t.id === tm.activeId).view.webContents.setZoomFactor(1.5);
  });
  await page.waitForTimeout(400);
  await copiaUrl(page);
  const avviso = page.locator('.sn-toast');
  await destroSopra(page, avviso);
  const voci = menuDi(page).locator('.sn-menu .sn-menu-item');
  await expect(voci).toHaveText(['Chiudi']);
  await voci.first().click();
  await expect(avviso).toHaveCount(0, { timeout: 1500 });
});

test('pagina web, durata normale: «Chiudi» scelto subito chiude l’avviso', async ({ shell, openTab, testServer }) => {
  await impostaDurata(shell, 8);
  const page = await testServer.openReady(openTab, PAGE);
  await page.waitForTimeout(300);
  await copiaUrl(page);
  const avviso = page.locator('.sn-toast');
  await destroSopra(page, avviso);
  const voci = menuDi(page).locator('.sn-menu .sn-menu-item');
  await expect(voci).toHaveText(['Chiudi']);
  await voci.first().click();
  await expect(avviso).toHaveCount(0, { timeout: 1500 });
});

test('«Aperti per dopo»: tasto destro sull’avviso «rimossa» offre «Annulla» e «Chiudi»; «Chiudi» lo chiude e la pagina resta tolta', async ({ openTab }) => {
  const home = await openTab('filo://home/home.html');
  await home.evaluate(async () => {
    const ora = Date.now();
    await chrome.storage.local.set({
      savedPages: [
        { id: 'a', url: 'https://example.com/a', title: 'Pagina A', favicon: '', thumbnail: '', savedAt: new Date(ora - 3600e3).toISOString(), categoryId: null, category: null },
        { id: 'b', url: 'https://example.com/b', title: 'Pagina B', favicon: '', thumbnail: '', savedAt: new Date(ora - 7200e3).toISOString(), categoryId: null, category: null },
      ],
      categories: [],
    });
    await window.SN_STORAGE.updateSettings({ featureFlags: { categorize: false } });
  });
  await home.reload();
  await home.waitForLoadState('domcontentloaded');
  const scheda = home.locator('#grid .sn-card[data-page-id="a"]');
  await expect(scheda).toBeVisible();
  await scheda.click({ button: 'right' });
  await home.locator('.home-ctxmenu .sn-select-option', { hasText: 'Rimuovi' }).click();
  const avviso = home.locator('.home-annulla:not([data-sn-closing])');
  await expect(avviso).toBeVisible();
  await destroSopra(home, avviso);
  const voci = menuDi(home).locator('.sn-menu .sn-menu-item');
  await expect(voci).toHaveText([/Annulla/, 'Chiudi']);
  await voci.nth(1).click();
  await expect(avviso).toHaveCount(0, { timeout: 1500 });
  const salvate = await home.evaluate(async () => (await chrome.storage.local.get('savedPages')).savedPages || []);
  expect(salvate.map((p) => p.id)).toEqual(['b']);
});
