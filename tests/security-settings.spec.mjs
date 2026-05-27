// Sicurezza (security settings):
//
//   - default delle impostazioni applicato (protectIpLeak + blockPopups ON)
//   - la pagina filo://security/ esiste, ha titolo "Sicurezza" e mostra
//     i due toggle + il box informativo sui servizi P2P
//   - il toggle si persiste nello storage dopo "Salva"
//   - il popup blocker DAVVERO blocca un window.open() automatico (apertura
//     senza gesto utente) — asserzione del successo: nessun nuovo tab creato
//   - quando il popup blocker è disattivato, lo stesso window.open() PASSA
//     (controllo che il test non sia un falso positivo dovuto ad altro)

import { test, expect } from './fixtures/electron.mjs';

test('default settings: security.protectIpLeak e blockPopups sono ON', async ({ openTab }) => {
  const page = await openTab('filo://security/');
  await expect(page.locator('#sec-protect-ip')).toBeAttached({ timeout: 8_000 });
  await expect(page.locator('#sec-protect-ip')).toBeChecked();
  await expect(page.locator('#sec-block-popups')).toBeChecked();
});

test('pagina Sicurezza dedicata: titolo + due toggle + box P2P', async ({ openTab }) => {
  const page = await openTab('filo://security/');
  await expect(page).toHaveTitle(/Sicurezza/);
  await expect(page.locator('#title')).toHaveText('Sicurezza', { timeout: 8_000 });
  await expect(page.locator('#sec-protect-ip-label')).toHaveText(/IP locale.*WebRTC/i);
  await expect(page.locator('#sec-block-popups-label')).toHaveText(/popup non richiesti/i);
  await expect(page.locator('#sec-p2p-box-title')).toContainText(/P2P/);
  await expect(page.locator('#sec-p2p-box-body')).toContainText(/Snapdrop/);
});

test('voce "Sicurezza" nel menu Impostazioni con icona lucchetto', async ({ shell, app }) => {
  // Click sull'ingranaggio per aprire il dropdown. Il menu è una BrowserWindow
  // separata (popup-menu.js) che si carica via `data:text/html` URL.
  const before = new Set(app.windows().map((w) => w.url()));
  await shell.locator('#nav-settings').click();
  // Aspetta che compaia una nuova window con URL data:text/html (popup-menu)
  const deadline = Date.now() + 4_000;
  let menuWin = null;
  while (Date.now() < deadline) {
    menuWin = app.windows().find((w) => w.url().startsWith('data:text/html') && !before.has(w.url()));
    if (menuWin) break;
    await new Promise((r) => setTimeout(r, 80));
  }
  expect(menuWin, 'il popup del menu Impostazioni deve aprirsi').toBeTruthy();
  // Verifica che la voce "Sicurezza" sia presente nel menu
  await expect(menuWin.locator('text=Sicurezza')).toBeVisible({ timeout: 3_000 });
});

test('toggle persistito dopo salvataggio', async ({ openTab }) => {
  const page = await openTab('filo://security/');
  await page.waitForSelector('#sec-protect-ip', { timeout: 8_000 });

  // Disabilita la protezione IP e salva
  await page.locator('#sec-protect-ip').uncheck();
  await page.locator('#save').click();
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Ricarica la pagina e verifica che il toggle sia rimasto disabilitato
  await page.reload();
  await page.waitForSelector('#sec-protect-ip', { timeout: 8_000 });
  await expect(page.locator('#sec-protect-ip')).not.toBeChecked();
  // L'altro toggle dev'essere rimasto ON (default)
  await expect(page.locator('#sec-block-popups')).toBeChecked();
});

test('popup blocker: window.open() automatico viene bloccato', async ({ openTab, testServer, shell }) => {
  // Pagina che chiama window.open() AL CARICAMENTO (no gesto utente) — è il
  // pattern degli ad popup. Disposition 'new-window' (per via di features=popup)
  // → blocco attivo.
  const popupTarget = testServer.html('<title>POPUP_TARGET_AD</title><p>popup</p>');
  const opener = testServer.html(`
    <title>OPENER_AD</title>
    <script>
      setTimeout(() => { window.open(${JSON.stringify(popupTarget)}, '_blank', 'popup,width=400,height=300'); }, 200);
    </script>
    <p>opener</p>
  `);

  await openTab(opener);
  await new Promise((r) => setTimeout(r, 1500));

  // Cerca via titolo univoco: il tab del popup, se aperto, riceverebbe il
  // page-title-updated con 'POPUP_TARGET_AD'. Includiamo anche il match per
  // url completo come ulteriore verifica.
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const popupTab = snap.tabs.find((t) => (t.title || '').includes('POPUP_TARGET_AD') || t.url === popupTarget);
  expect(popupTab, `il tab del popup non deve esistere — snap: ${JSON.stringify(snap.tabs.map((x) => ({ t: x.title, u: x.url })))}`).toBeFalsy();
});

test('popup blocker disattivato: window.open() passa', async ({ openTab, testServer, shell }) => {
  // Prima disattiva il blocco dalla pagina Sicurezza
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#sec-block-popups', { timeout: 8_000 });
  await sec.locator('#sec-block-popups').uncheck();
  await sec.locator('#save').click();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Ora ripeti il window.open automatico: deve aprire un nuovo tab
  const popupTarget = testServer.html('<title>POPUP_TARGET_OK</title><p>open</p>');
  const opener = testServer.html(`
    <title>OPENER_OK</title>
    <script>
      setTimeout(() => { window.open(${JSON.stringify(popupTarget)}, '_blank', 'popup,width=400,height=300'); }, 200);
    </script>
    <p>opener</p>
  `);

  await openTab(opener);
  await new Promise((r) => setTimeout(r, 2000));
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const popupTab = snap.tabs.find((t) => (t.title || '').includes('POPUP_TARGET_OK') || t.url === popupTarget);
  expect(popupTab, `col blocco disattivato il popup deve aprirsi — snap: ${JSON.stringify(snap.tabs.map((x) => ({ t: x.title, u: x.url })))}`).toBeTruthy();
});
