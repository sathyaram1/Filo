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
  // L'ingranaggio è un trigger interno nascosto (la sua icona vive ora dentro la
  // home): lo azioniamo con un click DOM diretto, come il bridge.
  await shell.evaluate(() => document.getElementById('nav-settings').click());
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

test('voce "Modelli" nel menu Impostazioni ha icona dedicata, diversa dall\'ingranaggio', async ({ shell, app }) => {
  const before = new Set(app.windows().map((w) => w.url()));
  // L'ingranaggio è un trigger interno nascosto (la sua icona vive ora dentro la
  // home): lo azioniamo con un click DOM diretto, come il bridge.
  await shell.evaluate(() => document.getElementById('nav-settings').click());
  const deadline = Date.now() + 4_000;
  let menuWin = null;
  while (Date.now() < deadline) {
    menuWin = app.windows().find((w) => w.url().startsWith('data:text/html') && !before.has(w.url()));
    if (menuWin) break;
    await new Promise((r) => setTimeout(r, 80));
  }
  expect(menuWin, 'il popup del menu Impostazioni deve aprirsi').toBeTruthy();
  // La voce "Modelli" deve esistere con icona dedicata (rete neurale a 3 nodi),
  // non più riusare l'ingranaggio "options" che si confonde con Impostazioni.
  const modelliBtn = menuWin.locator('.item', { hasText: 'Modelli' });
  await expect(modelliBtn).toBeVisible({ timeout: 3_000 });
  const modelliSvg = await modelliBtn.locator('svg').innerHTML();
  // I tre cerchi della nostra icona "models" sono il segno distintivo.
  expect(modelliSvg).toMatch(/circle[^>]*cx="12"[^>]*cy="5"/);
  expect(modelliSvg).toMatch(/circle[^>]*cx="5\.5"/);
  expect(modelliSvg).toMatch(/circle[^>]*cx="18\.5"/);
});

test('toggle persistito dopo salvataggio', async ({ openTab }) => {
  const page = await openTab('filo://security/');
  await page.waitForSelector('#sec-protect-ip', { timeout: 8_000 });

  // Disabilita la protezione IP: niente pulsante Salva, il cambiamento si
  // applica e persiste subito (il "Salvato" lampeggia come conferma).
  await page.locator('#sec-protect-ip').uncheck();
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Ricarica la pagina e verifica che il toggle sia rimasto disabilitato
  await page.reload();
  await page.waitForSelector('#sec-protect-ip', { timeout: 8_000 });
  await expect(page.locator('#sec-protect-ip')).not.toBeChecked();
  // L'altro toggle dev'essere rimasto ON (default)
  await expect(page.locator('#sec-block-popups')).toBeChecked();
});

test('siti fidati: un dominio non valido mostra un avviso e NON sparisce in silenzio (#218)', async ({ openTab }) => {
  const page = await openTab('filo://security/');
  await page.waitForSelector('#cookie-wl-input', { timeout: 8_000 });

  // I "siti fidati" sono attivi solo in "Privacy massima": selezionala per
  // abilitare il campo.
  await page.locator('#cookie-mode-privacy').check();
  await expect(page.locator('#cookie-wl-input')).toBeEnabled();

  // Valore non valido (host a etichetta singola): senza il fix spariva muto.
  await page.locator('#cookie-wl-input').fill('localhost');
  await page.locator('#cookie-wl-add-btn').click();

  // SUCCESSO = compare un avviso d'errore visibile e il testo resta nel campo
  // (così l'utente può correggerlo), e NON viene aggiunto nulla alla lista.
  await expect(page.locator('#cookie-wl-error')).toBeVisible();
  await expect(page.locator('#cookie-wl-error')).toContainText(/dominio valido/i);
  await expect(page.locator('#cookie-wl-input')).toHaveValue('localhost');
  await expect(page.locator('#cookie-wl-list li span')).toHaveCount(0);

  // Un IP è ugualmente rifiutato con avviso.
  await page.locator('#cookie-wl-input').fill('192.168.1.1');
  await page.locator('#cookie-wl-add-btn').click();
  await expect(page.locator('#cookie-wl-error')).toBeVisible();
  await expect(page.locator('#cookie-wl-list li span')).toHaveCount(0);

  // Un dominio valido invece viene aggiunto e l'avviso sparisce.
  await page.locator('#cookie-wl-input').fill('example.com');
  await page.locator('#cookie-wl-add-btn').click();
  await expect(page.locator('#cookie-wl-list li span')).toHaveText(['example.com']);
  await expect(page.locator('#cookie-wl-error')).toBeHidden();
  await expect(page.locator('#cookie-wl-input')).toHaveValue('');
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

test('popup blocker: i popup di login (OAuth) restano consentiti col blocco attivo (#209)', async ({ openTab, testServer, app, shell }) => {
  // Il blocco-popup è ON di default. Un popup verso un endpoint di
  // autenticazione (parametri OAuth client_id+redirect_uri) NON è pubblicità:
  // deve aprirsi come VERA finestra (così l'opener riceve l'esito del login),
  // non venire bloccato né degradato a scheda. Senza il fix #209 veniva negato.
  const authTarget = testServer.html('<title>AUTH_POPUP_OK</title><p>login</p>')
    + '?client_id=abc&redirect_uri=https%3A%2F%2Fapp.example%2Fcb&response_type=code';
  const opener = testServer.html(`
    <title>OPENER_AUTH</title>
    <script>
      setTimeout(() => { window.open(${JSON.stringify(authTarget)}, '_blank', 'popup,width=480,height=640'); }, 200);
    </script>
    <p>opener</p>
  `);

  await openTab(opener);

  // Il popup OAuth si apre come BrowserWindow reale: compare tra le window.
  let popupWin = null;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !popupWin) {
    await new Promise((r) => setTimeout(r, 200));
    popupWin = app.windows().find((w) => {
      try { return w.url().includes('client_id=abc'); } catch (_) { return false; }
    });
  }
  expect(popupWin, 'il popup di login deve aprirsi come finestra reale').toBeTruthy();

  // E NON deve essere stato degradato a scheda nella shell.
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const asTab = snap.tabs.find((t) => (t.url || '').includes('client_id=abc'));
  expect(asTab, 'il popup di login non deve diventare una scheda').toBeFalsy();
});

test('popup blocker disattivato: window.open() passa', async ({ openTab, testServer, shell }) => {
  // Prima disattiva il blocco dalla pagina Sicurezza (auto-save al toggle)
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#sec-block-popups', { timeout: 8_000 });
  await sec.locator('#sec-block-popups').uncheck();
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
