// Regression test per il feedback "incollando un'immagine vecchia dalla
// cronologia compare 'provider ha fallito' anche se le immagini sono salvate
// offline (nessuna chiamata al provider AI)".
//
// Causa: pasteHistoryEntry() mostrava `err_provider_failed` quando:
//  - il target non era contenteditable (campo testo/textarea), e
//  - quando insertImageInEditable() falliva.
// Il messaggio è fuorviante: nessun provider viene chiamato — l'immagine è
// in cronologia locale come dataUrl.
//
// Fix: in entrambi i rami mostriamo un toast pertinente
// (`toast_cannot_paste_image` o `toast_paste_failed`) — niente più
// "provider ha fallito" associato all'incolla.
//
// Usiamo la newtab (filo://newtab/, dashboard) come terreno di test: ha un
// `<input type="text">` (campo non-contenteditable, dove l'incolla immagine
// dalla cronologia esercita esattamente il ramo del bug).

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

test('incolla immagine vecchia dalla cronologia in input testuale: toast NON menziona "provider"', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 8_000 },
  );

  // Pre-popola la cronologia clipboard con un'immagine fittizia (1×1 PNG).
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const ok = await page.evaluate(async (du) => {
    const r = await chrome.runtime.sendMessage({
      type: 'push_clipboard_entry',
      entry: { type: 'image', dataUrl: du, description: 'test fixture' },
    });
    return !!r?.ok;
  }, dataUrl);
  expect(ok).toBeTruthy();

  // Tasto destro sull'input testuale della dashboard.
  await page.locator('#input').focus();
  await page.locator('#input').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();

  // Apri il sotto-menu cronologia (click sulla freccetta dell'item Incolla).
  const arrow = page.locator('.sn-menu .sn-menu-paste-arrow').first();
  await expect(arrow).toBeVisible();
  await arrow.click();

  // Clicca l'entry immagine dalla cronologia.
  const histItem = page.locator('.sn-menu-sub .sn-menu-history-item').first();
  await expect(histItem).toBeVisible({ timeout: 2000 });
  await histItem.click();

  // Aspetta il toast.
  const toast = page.locator('.sn-toast').first();
  await expect(toast).toBeVisible({ timeout: 2000 });
  const text = ((await toast.textContent()) || '').toLowerCase();
  // Il messaggio NON deve menzionare "provider" o "api key": è fuorviante
  // perché la cronologia immagini è 100% offline (dataUrl in storage locale).
  expect(text).not.toContain('provider');
  expect(text).not.toContain('api key');
});
