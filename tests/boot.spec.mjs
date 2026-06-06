// Boot test: verifica che Filo si avvii, la shell carichi e la newtab si apra.
// Equivalente del smoke.spec.js dell'estensione.

import { test, expect } from './fixtures/electron.mjs';

test('la shell carica: niente barra URL, icone di navigazione visibili sulla home', async ({ shell }) => {
  await expect(shell.locator('.shell')).toBeVisible();
  await expect(shell.locator('#tab-new')).toBeVisible();
  // La barra dell'URL è stata rimossa del tutto.
  await expect(shell.locator('#addr')).toHaveCount(0);
  // Sulla home di Filo (newtab) la riga di navigazione con le icone resta visibile.
  await expect(shell.locator('nav.addr')).toBeVisible();
  await expect(shell.locator('#nav-home')).toBeVisible();
});

test('la newtab apre filo://newtab/ con la dashboard montata', async ({ shell, app }) => {
  // La newtab viene aperta automaticamente dal main process al boot.
  // Aspettiamo che compaia nella tab bar (l'aggiornamento arriva via IPC).
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  // La scheda della newtab si chiama "Home" (niente prefisso "Filo —").
  await expect(shell.locator('.tab .title')).toHaveText('Home', { timeout: 8_000 });

  // Recupera la Page del WebContentsView del tab e verifica la dashboard.
  // Polling: la newtab è una WebContentsView che può registrare la sua URL
  // qualche tick dopo che la scheda è comparsa nella tab bar.
  let tabPage = null;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    tabPage = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (tabPage) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(tabPage).toBeTruthy();
  await tabPage.waitForLoadState('domcontentloaded');
  await expect(tabPage.locator('#input')).toBeVisible();
  // Nota: i pulsanti Impostazioni/Home stanno nella toolbar della shell, non
  // nella pagina dashboard — qui non vanno cercati.
});

test('la pagina Options si apre via tab navigate', async ({ openTab }) => {
  const page = await openTab('filo://options/');
  // toBeVisible è troppo stretto per pagine lunghe (l'#title h1 può non essere
  // ancora dentro la viewport). Verifichiamo l'attached al DOM degli elementi
  // chiave + il title della pagina.
  await expect(page.locator('#apiKey')).toBeAttached({ timeout: 8_000 });
  await expect(page.locator('#apiKeyGemini')).toBeAttached();
  await expect(page).toHaveTitle(/Opzioni|Filo/);
});

test('la pagina History si apre', async ({ openTab }) => {
  const page = await openTab('filo://history/');
  await expect(page.locator('body')).toBeVisible();
});
