// AUDIT (prober): il suggerimento "Riordina e archivia le schede" cliccato dalla
// colonna dei suggerimenti della home usa il window.confirm NATIVO del browser,
// invece del popup di conferma in stile Filo (SN_CONFIRM_UI) che usa il bottone
// equivalente nella chat. Asimmetria fra due cammini equivalenti (PULISCI_TAB):
// il bottone chat -> Ui.confirm; il suggerimento -> window.confirm nativo.
//
// Assert di SUCCESSO: cliccando il suggerimento deve aprirsi il confirm di Filo
// (SN_CONFIRM_UI.confirm invocato), NON il window.confirm nativo. Oggi fallisce
// perche' src/pages/dashboard/dashboard.js:289 chiama window.confirm diretto.

import { test, expect } from './fixtures/electron.mjs';
import { lento } from './fixtures/tempi.mjs';

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

// test.fixme: repro del bug (oggi ROSSO). Documenta il comportamento atteso
// senza rendere rossa la regressione completa. Il fixer che chiude il feedback
// toglie `.fixme` per farlo diventare un assert vivo (deve passare col fix).
test('il suggerimento "Riordina schede" usa il confirm di Filo, non quello nativo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: lento(8_000) });
  const page = await newtabPage(app);

  // Se scatta un dialog nativo (confirm) del browser, lo registriamo: e' il bug.
  let nativeDialogFired = false;
  page.on('dialog', async (d) => {
    nativeDialogFired = true;
    await d.dismiss().catch(() => {});
  });

  // Inietta un suggerimento PULISCI_TAB via il bridge live del background
  // (stesso cammino di #155): chiama i listener di chrome.runtime.onMessage con
  // un FILO_DASHBOARD_UPDATED che porta il suggerimento, poi la home lo renderizza.
  await page.evaluate(() => {
    const listeners = chrome.runtime.onMessage._listeners;
    const msg = {
      type: 'filo_dashboard_updated',
      message: 'Filo e in ascolto.',
      suggestions: [{
        text: 'Riordina e archivia le schede',
        importance: 5,
        icon: '',
        action: { type: 'PULISCI_TAB' },
      }],
    };
    for (const l of listeners) l(msg, { id: 'filo-desktop' }, () => {});
  });

  // Il suggerimento deve essere renderizzato.
  const sug = page.locator('.dash-suggestion');
  await expect(sug.first()).toBeVisible({ timeout: lento(5_000) });

  // Strumenta i due cammini di conferma per capire QUALE viene usato.
  await page.evaluate(() => {
    window.__styledConfirmCalled = false;
    window.__nativeConfirmCalled = false;
    // Confirm nativo: registra e rifiuta (l'azione non deve partire).
    window.confirm = () => { window.__nativeConfirmCalled = true; return false; };
    // Confirm di Filo: registra e rifiuta.
    if (window.SN_CONFIRM_UI) {
      window.SN_CONFIRM_UI.confirm = () => {
        window.__styledConfirmCalled = true;
        return Promise.resolve(false);
      };
    }
  });

  await sug.first().click();
  // Da' tempo al ramo async di girare.
  await page.waitForTimeout(300);

  const { styled, native } = await page.evaluate(() => ({
    styled: !!window.__styledConfirmCalled,
    native: !!window.__nativeConfirmCalled,
  }));

  // Assert di SUCCESSO: il popup di Filo deve essere usato.
  expect(styled, 'il suggerimento dovrebbe usare il confirm di Filo (SN_CONFIRM_UI)').toBe(true);
  // E il nativo NON deve essere usato.
  expect(native, 'il suggerimento NON deve usare window.confirm nativo').toBe(false);
  expect(nativeDialogFired, 'non deve comparire un dialog nativo del browser').toBe(false);
});
