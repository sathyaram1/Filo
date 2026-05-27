// Sicurezza (security settings):
//
//   - default delle impostazioni applicato (protectIpLeak + blockPopups ON)
//   - la sezione "Sicurezza" appare nella pagina Opzioni con i due toggle e
//     il box informativo sui servizi P2P
//   - il toggle si persiste nello storage dopo "Salva"
//   - il popup blocker DAVVERO blocca un window.open() automatico (apertura
//     senza gesto utente) — l'asserzione del successo del blocco è "non viene
//     aperto un nuovo tab per quell'URL"
//   - quando il popup blocker è disattivato, lo stesso window.open() PASSA
//     (controllo che il test non sia un falso positivo dovuto ad altro)

import { test, expect } from './fixtures/electron.mjs';

test('default settings: security.protectIpLeak e blockPopups sono ON', async ({ openTab }) => {
  const page = await openTab('filo://options/');
  await expect(page.locator('#sec-protect-ip')).toBeAttached({ timeout: 8_000 });
  await expect(page.locator('#sec-protect-ip')).toBeChecked();
  await expect(page.locator('#sec-block-popups')).toBeChecked();
});

test('Opzioni: sezione "Sicurezza" presente con due toggle + box P2P', async ({ openTab }) => {
  const page = await openTab('filo://options/');
  await expect(page.locator('#h-security')).toHaveText('Sicurezza', { timeout: 8_000 });
  await expect(page.locator('#sec-protect-ip-label')).toHaveText(/IP locale.*WebRTC/i);
  await expect(page.locator('#sec-block-popups-label')).toHaveText(/popup non richiesti/i);
  await expect(page.locator('#sec-p2p-box-title')).toContainText(/P2P/);
  await expect(page.locator('#sec-p2p-box-body')).toContainText(/Snapdrop/);
});

test('toggle persistito dopo salvataggio', async ({ openTab }) => {
  const page = await openTab('filo://options/');
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

test('popup blocker: window.open() automatico viene bloccato', async ({ openTab, testServer, shell, app }) => {
  // Pagina che chiama window.open() AL CARICAMENTO (no gesto utente) — è il
  // pattern degli ad popup. Senza il blocco si aprirebbe un nuovo tab.
  const popupTarget = testServer.html('<title>POPUP-TARGET</title><p>popup</p>');
  const popupHost = new URL(popupTarget).host;
  const opener = testServer.html(`
    <title>OPENER</title>
    <script>
      // Esegui dopo il primo paint per dare tempo al preload di settarsi.
      setTimeout(() => { window.open(${JSON.stringify(popupTarget)}, '_blank', 'popup,width=400,height=300'); }, 200);
    </script>
    <p>opener</p>
  `);

  await openTab(opener);

  // Aspetta abbastanza tempo perché window.open scatti, e poi verifica che
  // NESSUN tab con quell'URL si sia aperto. Asserisce successo del blocco.
  await new Promise((r) => setTimeout(r, 1500));
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const popupTab = snap.tabs.find((t) => t.url && t.url.includes(popupHost) && t.url.includes(new URL(popupTarget).pathname));
  expect(popupTab, 'il tab del popup non deve essere stato creato').toBeFalsy();
});

test('popup blocker disattivato: window.open() passa', async ({ openTab, testServer, shell }) => {
  // Prima disattiva il blocco da Opzioni
  const opt = await openTab('filo://options/');
  await opt.waitForSelector('#sec-block-popups', { timeout: 8_000 });
  await opt.locator('#sec-block-popups').uncheck();
  await opt.locator('#save').click();
  await expect(opt.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Ora ripeti il window.open automatico: deve aprire un nuovo tab
  const popupTarget = testServer.html('<title>POPUP-OPEN</title><p>open</p>');
  const popupPath = new URL(popupTarget).pathname;
  const opener = testServer.html(`
    <title>OPENER2</title>
    <script>
      setTimeout(() => { window.open(${JSON.stringify(popupTarget)}, '_blank', 'popup,width=400,height=300'); }, 200);
    </script>
    <p>opener</p>
  `);

  await openTab(opener);
  await new Promise((r) => setTimeout(r, 1500));
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const popupTab = snap.tabs.find((t) => t.url && t.url.includes(popupPath));
  expect(popupTab, 'col blocco disattivato il popup deve aprirsi normalmente').toBeTruthy();
});
