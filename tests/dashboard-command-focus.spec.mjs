// Dopo aver INVIATO un comando dalla barra della dashboard, il cursore deve
// restare nella barra, così l'utente può scrivere subito il comando successivo
// senza ricliccare.
//
// Feedback utente: "dopo che viene inviato un comando il cursore rimane nella
// barra. adesso se scrivo /ls invio vedo la risposta ma devo ricliccare nella
// barra per scrivere un altro comando".
//
// I test ASSERISCONO il successo: dopo il submit, document.activeElement è di
// nuovo l'input. Coprono i tre cammini di submit che NON aprono una nuova
// scheda: comando shell (terminale), comando Filo interno (/help) e messaggio
// normale all'LLM.

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

async function setTerminal(page, enabled) {
  await page.evaluate((v) => new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { terminal: { enabled: v } } },
      (r) => resolve(r),
    );
  }), enabled);
}

// Vero quando il focus è sull'input della barra.
function inputIsFocused(page) {
  return page.evaluate(() => document.activeElement === document.getElementById('input'));
}

test('dopo un comando shell il focus torna nella barra', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await setTerminal(page, true);
  await expect(page.locator('#dashDir')).toBeVisible({ timeout: 8_000 });

  // Invio reale: clicca la barra, scrivi, premi Enter.
  await page.locator('#input').click();
  await page.locator('#input').fill('/echo filo-focus-OK');
  await page.locator('#input').press('Enter');

  // Il comando è stato eseguito davvero…
  await expect(page.locator('.dash-term-out')).toContainText('filo-focus-OK', { timeout: 12_000 });
  // …e il cursore è ancora nella barra (l'utente può scrivere subito).
  await expect.poll(() => inputIsFocused(page), { timeout: 4_000 }).toBe(true);
});

test('dopo un comando Filo interno (/help) il focus torna nella barra', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  await page.locator('#input').click();
  await page.locator('#input').fill('/help');
  await page.locator('#input').press('Enter');

  // /help scrive una bolla di aiuto…
  await expect(page.locator('.dash-bubble-filo')).toContainText('lista comandi', { timeout: 8_000 });
  // …e il cursore resta nella barra.
  await expect.poll(() => inputIsFocused(page), { timeout: 4_000 }).toBe(true);
});
