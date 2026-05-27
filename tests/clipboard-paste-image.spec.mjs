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

import { test, expect } from './fixtures/electron.mjs';

const PAGE_INPUT_ONLY = `<!doctype html><html><body>
  <input id="i" type="text" />
</body></html>`;

test('incollare immagine dalla cronologia in input testuale mostra messaggio chiaro (no provider failed)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE_INPUT_ONLY);

  // Pre-popola la cronologia clipboard con un'immagine fittizia.
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  await page.evaluate(async (du) => {
    await chrome.runtime.sendMessage({
      type: 'push_clipboard_entry',
      entry: { type: 'image', dataUrl: du, description: 'test fixture' },
    });
  }, dataUrl);

  // Focus + tasto destro sull'input testuale.
  await page.locator('#i').focus();
  await page.locator('#i').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();

  // Hover su "Incolla" per far apparire la freccetta cronologia.
  const incolla = page.locator('.sn-menu .sn-menu-paste-main').first();
  await incolla.hover();
  // Clicca la freccetta per aprire il sotto-menu cronologia.
  const arrow = page.locator('.sn-menu .sn-menu-paste-arrow').first();
  await arrow.click();

  // Clicca la prima entry del sotto-menu (immagine).
  const histItem = page.locator('.sn-menu-sub .sn-menu-history-item').first();
  await expect(histItem).toBeVisible();
  await histItem.click();

  // Aspetta toast.
  const toast = page.locator('.sn-toast').first();
  await expect(toast).toBeVisible({ timeout: 2000 });
  const text = (await toast.textContent()) || '';
  // Il messaggio NON deve menzionare "provider" o "API key": è fuorviante
  // perché la cronologia immagini è 100% offline.
  expect(text.toLowerCase()).not.toContain('provider');
  expect(text.toLowerCase()).not.toContain('api key');
});
