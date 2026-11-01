// Verifica #1681 giro 2, rilievo 1: premuto Invia, chi chiude la scheda mentre il riquadro aspetta la consegna non
// deve ritrovarsi il testo già mandato come bozza al riquadro dopo, dove un secondo Invia farebbe un doppione.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app, esclusa = null) {
  let win = null;
  await expect.poll(() => {
    win = app.windows().find((w) => { try { return w !== esclusa && !w.isClosed() && w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    return !!win;
  }, { timeout: 10_000 }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

test('r1 chiusa la scheda durante «Invio in corso», il feedback consegnato non torna come bozza', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await app.evaluate(() => {
    globalThis.__rete = { payload: [], sblocca: null, consegnati: 0 };
    globalThis.SN_FEEDBACK.submit = async (p) => {
      globalThis.__rete.payload.push(p);
      await new Promise((r) => { globalThis.__rete.sblocca = r; });
      globalThis.__rete.consegnati++;
      return { id: 'fb-1', seq: 1, failed: [] };
    };
  });
  const prima = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return ((Array.isArray(s) ? s : s.tabs) || [])[0].id;
  });

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('Il tasto Salva non risponde');
  await page.waitForTimeout(600);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-status')).toContainText('Invio in corso');

  // Premuto Invia, l'utente passa ad altro: apre una scheda nuova e chiude quella da cui ha mandato.
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 8_000 });
  await shell.evaluate((i) => window.filoShell.tabs.close(i), prima);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  await expect.poll(() => app.evaluate(() => typeof globalThis.__rete.sblocca === 'function')).toBe(true);
  await app.evaluate(() => globalThis.__rete.sblocca());
  await expect.poll(() => app.evaluate(() => globalThis.__rete.consegnati)).toBe(1);

  const altra = await newtabPage(app, page);
  await altra.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(altra.locator('.sn-fb-modal')).toBeVisible();
  await altra.waitForTimeout(1200);
  await expect(altra.locator('.sn-fb-text'), 'il testo consegnato non si ripropone come bozza').toHaveValue('');
});
