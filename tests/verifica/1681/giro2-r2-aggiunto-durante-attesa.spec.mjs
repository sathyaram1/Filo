// Verifica #1681 giro 2, rilievo 2: il riquadro resta modificabile mentre aspetta la consegna; quello che l'utente
// aggiunge in quei secondi (testo, un file) non deve sparire in silenzio quando arriva «inviato».
import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

test('r2 il testo e il file aggiunti durante «Invio in corso» o partono o restano nel riquadro', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await app.evaluate(() => {
    globalThis.__rete = { payload: [], sblocca: null };
    globalThis.SN_FEEDBACK.submit = async (p) => {
      globalThis.__rete.payload.push(p);
      await new Promise((r) => { globalThis.__rete.sblocca = r; });
      return { id: 'fb-1', seq: 1, failed: [] };
    };
  });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('Il tasto Salva non risponde');
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-status')).toContainText('Invio in corso');
  // Mentre aspetta, l'utente si ricorda un dettaglio e allega il registro.
  await page.locator('.sn-fb-text').press('End');
  await page.keyboard.type(' e succede solo col file aperto da ieri');
  await page.locator('.sn-fb-file').setInputFiles([{ name: 'registro.txt', mimeType: 'text/plain', buffer: Buffer.from('errore 42') }]);
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(1);
  await page.waitForTimeout(600);

  await expect.poll(() => app.evaluate(() => typeof globalThis.__rete.sblocca === 'function')).toBe(true);
  await app.evaluate(() => globalThis.__rete.sblocca());
  await expect(page.locator('.sn-toast').filter({ hasText: 'inviato' })).toHaveCount(1, { timeout: 8_000 });

  const partito = await app.evaluate(() => globalThis.__rete.payload[0]);
  const aperto = await page.locator('.sn-fb-modal').count();
  const restaTesto = aperto ? await page.locator('.sn-fb-text').inputValue() : '';
  const restaFile = aperto ? await page.locator('.sn-fb-file-chip').count() : 0;
  expect(partito.text.includes('file aperto da ieri') || restaTesto.includes('file aperto da ieri'),
    'il dettaglio aggiunto non sparisce').toBe(true);
  expect(partito.files.length === 1 || restaFile === 1, 'il file aggiunto non sparisce').toBe(true);
});

test('r2 durante «Invio in corso» il tasto Chiudi ed Esc fanno la stessa cosa', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await app.evaluate(() => {
    globalThis.__rete = { sblocca: null };
    globalThis.SN_FEEDBACK.submit = async () => { await new Promise((r) => { globalThis.__rete.sblocca = r; }); return { id: 'fb-1', seq: 1, failed: [] }; };
  });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('Il tasto Salva non risponde');
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-status')).toContainText('Invio in corso');
  await page.waitForTimeout(500);
  const chiudiAttivo = await page.locator('.sn-fb-cancel').isEnabled();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const escChiude = (await page.locator('.sn-fb-modal').count()) === 0;
  expect({ chiudiAttivo, escChiude }, 'chi chiude col tasto e chi con Esc ottiene lo stesso').toEqual({ chiudiAttivo: escChiude, escChiude });
  await expect.poll(() => app.evaluate(() => typeof globalThis.__rete.sblocca === 'function')).toBe(true);
  await app.evaluate(() => globalThis.__rete.sblocca());
});
