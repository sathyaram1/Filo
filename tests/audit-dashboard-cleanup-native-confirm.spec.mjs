// Il suggerimento "Riordina e archivia le schede" della home chiede conferma col popup di Filo (SN_CONFIRM_UI),
// come il bottone equivalente in chat, e mai col window.confirm nativo del browser.

import { test, expect } from './fixtures/electron.mjs';

const RIORDINA = 'Riordina e archivia le schede';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata entro 10s').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

test('il suggerimento "Riordina schede" usa il confirm di Filo, non quello nativo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  let nativeDialogFired = false;
  page.on('dialog', async (d) => {
    nativeDialogFired = true;
    await d.dismiss().catch(() => {});
  });

  // La prima risposta della home riscrive l'elenco dei suggerimenti: un suggerimento messo prima sparisce, e il
  // clic finiva su quello arrivato dopo («Apri Crediti»), facendo fallire la prova a caso (#944).
  await expect(page.locator('#homeMessage')).not.toHaveText('…', { timeout: 10_000 });

  // Stesso cammino del ricalcolo in sottofondo (#155): un FILO_DASHBOARD_UPDATED che porta il suggerimento.
  await page.evaluate((text) => {
    const msg = {
      type: 'filo_dashboard_updated',
      message: 'Filo e in ascolto.',
      suggestions: [{ text, importance: 5, icon: '', action: { type: 'PULISCI_TAB' } }],
    };
    for (const l of chrome.runtime.onMessage._listeners) l(msg, { id: 'filo-desktop' }, () => {});
  }, RIORDINA);

  const sug = page.locator('.dash-carta[data-tipo="suggerimenti"] .dash-carta-voce', { hasText: RIORDINA });
  await expect(sug).toBeVisible({ timeout: 5_000 });

  // Entrambe le conferme rispondono «no»: l'azione non deve partire, conta solo quale si apre.
  await page.evaluate(() => {
    window.__styledConfirmCalled = false;
    window.__nativeConfirmCalled = false;
    window.confirm = () => { window.__nativeConfirmCalled = true; return false; };
    if (window.SN_CONFIRM_UI) {
      window.SN_CONFIRM_UI.confirm = () => {
        window.__styledConfirmCalled = true;
        return Promise.resolve(false);
      };
    }
  });

  await sug.click();
  await expect.poll(() => page.evaluate(() => window.__styledConfirmCalled || window.__nativeConfirmCalled), {
    timeout: 3_000, message: 'cliccando il suggerimento non si è aperta nessuna conferma',
  }).toBe(true);

  const { styled, native } = await page.evaluate(() => ({
    styled: !!window.__styledConfirmCalled,
    native: !!window.__nativeConfirmCalled,
  }));
  expect(styled, 'il suggerimento dovrebbe usare il confirm di Filo (SN_CONFIRM_UI)').toBe(true);
  expect(native, 'il suggerimento NON deve usare window.confirm nativo').toBe(false);
  expect(nativeDialogFired, 'non deve comparire un dialog nativo del browser').toBe(false);
});
