// Boot test: verifica che Filo si avvii, la shell carichi e la newtab si apra.
// Equivalente del smoke.spec.js dell'estensione.

import { test, expect } from './fixtures/electron.mjs';

test('la shell carica e mostra la barra indirizzi', async ({ shell }) => {
  await expect(shell.locator('.shell')).toBeVisible();
  await expect(shell.locator('#addr')).toBeVisible();
  await expect(shell.locator('#tab-new')).toBeVisible();
});

test('la newtab apre filo://newtab/ con la dashboard montata', async ({ shell, app }) => {
  // La newtab viene aperta automaticamente dal main process al boot.
  // Aspettiamo che compaia nella tab bar (l'aggiornamento arriva via IPC).
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await expect(shell.locator('.tab .title')).toContainText('Filo', { timeout: 8_000 });

  // Recupera la Page del WebContentsView del tab e verifica la dashboard.
  const allWindows = app.windows();
  const tabPage = allWindows.find((w) => w.url().startsWith('filo://newtab'));
  expect(tabPage).toBeTruthy();
  await tabPage.waitForLoadState('domcontentloaded');
  await expect(tabPage.locator('#input')).toBeVisible();
  await expect(tabPage.locator('#settingsBtn')).toBeVisible();
});

test('la pagina Options si apre via tab navigate', async ({ openTab }) => {
  const page = await openTab('filo://options/');
  // toBeVisible è troppo stretto per pagine lunghe (l'#title h1 può non essere
  // ancora dentro la viewport). Verifichiamo l'attached al DOM degli elementi
  // chiave + il title della pagina.
  await expect(page.locator('#apiKey')).toBeAttached({ timeout: 8_000 });
  await expect(page.locator('#provider')).toBeAttached();
  await expect(page).toHaveTitle(/Opzioni|Filo/);
});

test('la pagina History si apre', async ({ openTab }) => {
  const page = await openTab('filo://history/');
  await expect(page.locator('body')).toBeVisible();
});
