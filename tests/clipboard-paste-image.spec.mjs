// Regression test per il feedback "Incolla → cronologia → immagine non funziona
// negli stessi posti dove Ctrl+V immagine funziona (barra home, box feedback)".
//
// Asserisce IL SUCCESSO della feature, non l'assenza di un messaggio brutto:
// verifica che, dopo aver pre-popolato la cronologia con un'immagine e dopo
// aver navigato il menu Filo Incolla → cronologia → entry-immagine, la
// dashboard mostri l'anteprima allegata (#imgPreview) — esattamente come
// quando l'utente fa Ctrl+V su un'immagine.

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

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('Incolla → cronologia → immagine allega l\'immagine nella barra home (parità con Ctrl+V)', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 8_000 },
  );

  // Sanity: l'anteprima immagine non c'è ancora.
  await expect(page.locator('#imgPreview')).toHaveCount(0);

  // Pre-popola la cronologia clipboard con un'immagine.
  const ok = await page.evaluate(async (du) => {
    const r = await chrome.runtime.sendMessage({
      type: 'push_clipboard_entry',
      entry: { type: 'image', dataUrl: du, description: 'png 1x1 di test' },
    });
    return !!r?.ok;
  }, PNG_1x1);
  expect(ok).toBeTruthy();

  // Tasto destro sulla barra home, naviga il sotto-menu cronologia.
  await page.locator('#input').focus();
  await page.locator('#input').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();

  const arrow = page.locator('.sn-menu .sn-menu-paste-arrow').first();
  await expect(arrow).toBeVisible();
  await arrow.click();

  const histItem = page.locator('.sn-menu-sub .sn-menu-history-item').first();
  await expect(histItem).toBeVisible({ timeout: 2000 });
  await histItem.click();

  // Successo: la dashboard deve mostrare l'anteprima dell'immagine allegata,
  // identica al risultato di un Ctrl+V su immagine.
  const preview = page.locator('#imgPreview img');
  await expect(preview).toBeVisible({ timeout: 2000 });
  const src = await preview.getAttribute('src');
  expect(src, 'src dell\'anteprima deve essere una dataURL immagine').toMatch(/^data:image\//);

  // E il pulsante per rimuoverla esiste (invariante UX: chi può aggiungere può
  // togliere — esattamente come dopo Ctrl+V).
  await expect(page.locator('#imgPreview .dash-img-remove')).toBeVisible();
});
