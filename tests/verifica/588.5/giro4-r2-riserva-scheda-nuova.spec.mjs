// Verifica #588.5 giro 4, rilievo 2 — una scheda aperta mentre un avviso della barra è a schermo: quando l'avviso se
// ne va, gli avvisi di Filo dentro quella pagina tornano giù nell'angolo (non restano alzati per sempre).
import { test, expect } from '../../fixtures/electron.mjs';

test('scheda aperta con un avviso a schermo: chiuso l’avviso, «Copiato negli appunti» torna in fondo', async ({ app, shell, testServer, avvisi }) => {
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);

  const url = testServer.html(`<!doctype html><html><body style="margin:0;padding:24px">
    <a id="link" href="https://example.com/articolo">Un collegamento di prova</a></body></html>`);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 15000 }).toBe(true);
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);

  await vista.locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisi.vista.getBounds().width)).toBe(0);

  // Un'azione di Filo sulla pagina che risponde col suo avviso, dal tasto destro.
  const menu = page.locator('.sn-menu');
  let fatto = false;
  for (let i = 0; i < 6 && !fatto; i++) {
    await page.locator('#link').click({ button: 'right', position: { x: 8, y: 8 } });
    const voce = menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' });
    try {
      await voce.first().waitFor({ state: 'visible', timeout: 1500 });
      await voce.first().click();
      fatto = true;
    } catch (_) { await page.waitForTimeout(200); }
  }
  expect(fatto, 'voce «Copia URL» non raggiungibile').toBe(true);
  await expect(page.locator('.sn-toast')).toHaveCount(1, { timeout: 5000 });
  const fondo = () => page.evaluate(() => Math.round(innerHeight - document.querySelector('.sn-toasts').getBoundingClientRect().bottom));
  await expect.poll(fondo, { timeout: 3000 }).toBeLessThanOrEqual(24);
});
