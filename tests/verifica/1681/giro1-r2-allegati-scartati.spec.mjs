// Verifica #1681 giro 1, rilievo 2: un allegato che il riquadro scarta prima dell'invio (troppo grande, oltre il
// numero) va detto col suo nome e il motivo, come quelli che non salgono.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('r2 scegliendo insieme un file troppo grande e uno buono, il riquadro dice quale è rimasto fuori', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-file').setInputFiles([
    { name: 'registro-enorme.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5 * 1024 * 1024, 65) },
    { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('ciao') },
  ]);
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(1);
  await expect(page.locator('.sn-fb-status'), 'il file scartato si nomina, col motivo').toContainText('registro-enorme.pdf');
  await expect(page.locator('.sn-fb-status')).toContainText('4 MB');
});

test('r2 con cinque immagini allegate e lo screenshot chiesto, lo screenshot che resta fuori si dice', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await app.evaluate(() => {
    globalThis.__rete = { payload: [] };
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__rete.payload.push(p); return { id: 'fb-1', seq: 1, failed: [] }; };
  });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-file').setInputFiles([1, 2, 3, 4, 5].map((i) => ({ name: `foto${i}.png`, mimeType: 'image/png', buffer: PNG })));
  await expect(page.locator('.sn-fb-thumb')).toHaveCount(5);
  await page.locator('.sn-fb-text').fill('Guarda lo schermo');
  await page.locator('.sn-fb-clear').click();
  await expect(page.locator('.sn-fb-clear')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 15_000 });
  const nomi = await app.evaluate(() => globalThis.__rete.payload[0].images.map((i) => i.name));
  const detto = await page.locator('.sn-toast, .sn-fb-status').allTextContents();
  // O lo screenshot parte, o chi l'ha chiesto legge che è rimasto fuori.
  expect(nomi.includes('schermata annotata') || detto.some((t) => /screenshot|schermata/i.test(t)),
    `immagini partite: ${nomi.join(', ')}; detto: ${detto.join(' | ')}`).toBe(true);
});
