// Verifica #1681 giro 1, rilievo 3: il feedback senza testo il cui unico allegato il deposito rifiuta non parte, e lo
// dice il riquadro, che resta aperto. Non serve dirlo una seconda volta nella cornice della finestra.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

test('r3 il feedback vuoto che non parte si legge nel riquadro, senza un secondo avviso uguale nella finestra', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  // Finta è solo la rete: il deposito rifiuta, il resto non risponde.
  await app.evaluate(() => {
    globalThis.fetch = async (u) => {
      if (/firebasestorage/.test(String(u))) return new Response('no', { status: 403 });
      throw new Error('fetch failed');
    };
  });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-file').setInputFiles([{ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }]);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-status')).toContainText('«foto.png»: rifiutato dal deposito', { timeout: 10_000 });
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(shell.locator('.shell-notif').filter({ hasText: 'non è partito' })).toHaveCount(0);
});
