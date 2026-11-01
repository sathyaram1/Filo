// Verifica #1681 giro 1, rilievo 1: il riquadro chiuso con Esc mentre l'invio aspetta la consegna, riaperto per
// scrivere altro: la consegna del primo non deve chiudere il secondo né cancellarne la bozza.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

test('r1 la consegna di un feedback partito non chiude il riquadro riaperto per scriverne un altro', async ({ app, shell }) => {
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
  // La rete è lenta: l'utente chiude con Esc e riapre per scrivere un'altra cosa.
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.locator('.sn-fb-text').fill('Secondo problema: la barra sparisce');
  await page.waitForTimeout(800);

  await app.evaluate(() => globalThis.__rete.sblocca());
  await expect(page.locator('.sn-toast').filter({ hasText: 'inviato' })).toHaveCount(1, { timeout: 8_000 });
  await expect(page.locator('.sn-fb-modal'), 'il riquadro che l’utente sta scrivendo resta aperto').toBeVisible();
  await expect(page.locator('.sn-fb-text')).toHaveValue('Secondo problema: la barra sparisce');
  // E se lo chiude lui, il testo resta come bozza.
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-text')).toHaveValue('Secondo problema: la barra sparisce');
});
