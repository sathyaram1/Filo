// Verifica #1204.4 giro 1: «Chiudi» dal tasto destro con due avvisi nella pila della pagina.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PAGE = `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif;height:100vh">
  <h1>Pagina con un collegamento</h1>
  <a id="link" href="https://example.com/articolo">Un collegamento di prova</a>
</body></html>`;

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

async function chiudiDalMenu(page, avviso) {
  await expect(avviso).toHaveClass(/sn-toast-visible|show/);
  await page.waitForTimeout(250);
  const b = await avviso.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  const voci = menuDi(page).locator('.sn-menu .sn-menu-item');
  await expect(voci).toHaveText(['Chiudi']);
  await voci.first().click();
}

test('due avvisi: «Chiudi» dal tasto destro chiude quello indicato, poi l’altro', async ({ shell, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { notifications: { durationSec: 0, soundEnabled: false, sound: 'default' } },
  }));
  const page = await testServer.openReady(openTab, PAGE);
  await page.waitForTimeout(300);
  await copiaUrl(page);
  await copiaUrl(page);
  const avvisi = page.locator('.sn-toast');
  await expect(avvisi).toHaveCount(2);
  await page.evaluate(() => document.querySelectorAll('.sn-toast')[0].setAttribute('data-prova', 'primo'));
  await chiudiDalMenu(page, avvisi.first());
  await expect(avvisi).toHaveCount(1, { timeout: 1500 });
  await expect(page.locator('.sn-toast[data-prova="primo"]')).toHaveCount(0);
  await page.waitForTimeout(800);
  await expect(avvisi).toHaveCount(1);
  await chiudiDalMenu(page, avvisi.first());
  await expect(avvisi).toHaveCount(0, { timeout: 1500 });
});
