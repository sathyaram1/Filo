// Feedback alpha #5: poter disattivare dalle Preferenze il commento proattivo
// di Filo al centro della home (newtab). Il toggle è `showHomeMessage`.

import { test, expect } from './fixtures/electron.mjs';

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

async function setShowHomeMessage(page, value) {
  await page.evaluate((v) => new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { showHomeMessage: v } },
      (r) => resolve(r),
    );
  }), value);
}

test('di default il commento centrale è visibile (#5)', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#homeMessage')).toBeVisible({ timeout: 8_000 });
});

test('disattivando il toggle il commento sparisce subito e resta nascosto nelle nuove schede (#5)', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#homeMessage')).toBeVisible({ timeout: 8_000 });

  // Disattiva: il broadcast SETTINGS_UPDATED deve nascondere il commento live.
  await setShowHomeMessage(page, false);
  await expect(page.locator('#homeMessage')).toBeHidden({ timeout: 8_000 });

  // La preferenza è persistita: una nuova scheda nasce senza commento.
  const page2 = await openTab('filo://newtab/');
  await expect(page2.locator('#homeMessage')).toBeHidden({ timeout: 8_000 });

  // Riattivando torna visibile.
  await setShowHomeMessage(page2, true);
  await expect(page2.locator('#homeMessage')).toBeVisible({ timeout: 8_000 });
});

test('la pagina Preferenze espone il toggle e ne riflette lo stato (#5)', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  const box = page.locator('#showHomeMessage');
  await expect(box).toBeVisible({ timeout: 8_000 });
  // Default: spuntato.
  await expect(box).toBeChecked();
  // Togli la spunta → niente pulsante Salva, l'auto-save persiste subito
  // (il "Salvato" lampeggia come conferma). Ricaricando lo stato è persistito.
  await box.uncheck();
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  await page.reload();
  await expect(page.locator('#showHomeMessage')).not.toBeChecked({ timeout: 8_000 });
});
