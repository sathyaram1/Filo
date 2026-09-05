// Boot test: verifica che Filo si avvii, la shell carichi e la newtab si apra.
// Equivalente del smoke.spec.js dell'estensione.

import { test, expect } from './fixtures/electron.mjs';

test('la shell carica: niente barra in alto, resta solo la fila di tab', async ({ shell }) => {
  await expect(shell.locator('.shell')).toBeVisible();
  await expect(shell.locator('#tab-new')).toBeVisible();
  // La barra dell'URL è stata rimossa del tutto.
  await expect(shell.locator('#addr')).toHaveCount(0);
  // La barra in alto (icone di navigazione + home/impostazioni/app/profilo) è
  // sparita anche dalla home: le icone vivono ora DENTRO la home. La nav resta
  // nel DOM come trigger interno dei menu, ma non è visibile.
  await expect(shell.locator('nav.addr')).toBeHidden();
});

test('la newtab apre filo://newtab/ con la dashboard montata', async ({ shell, app }) => {
  // La newtab viene aperta automaticamente dal main process al boot.
  // Aspettiamo che compaia nella tab bar (l'aggiornamento arriva via IPC).
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  // La newtab si chiama "Home" (vedi FILO_TAB_LABELS in shell.js): niente più
  // prefisso "Filo —".
  await expect(shell.locator('.tab .title')).toContainText('Home', { timeout: 8_000 });

  // Recupera la Page del WebContentsView del tab e verifica la dashboard.
  // Polling: il WebContentsView della newtab può non essere ancora fra le
  // app.windows() nell'istante esatto in cui la tab compare nella bar (l'IPC
  // della tab bar e l'attach della view non sono sincroni). Vedi la nota sulla
  // race in fixtures/electron.mjs.
  let tabPage = null;
  const deadline = Date.now() + 10_000;
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
  await expect(page.locator('#apiKeyTavily')).toBeAttached();
  await expect(page).toHaveTitle(/Opzioni|Filo/);
});

test('la pagina History si apre', async ({ openTab }) => {
  const page = await openTab('filo://history/');
  await expect(page.locator('body')).toBeVisible();
});
