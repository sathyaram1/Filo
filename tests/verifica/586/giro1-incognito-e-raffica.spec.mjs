// Verifica #586, giro 1 — incognito e raffica di richieste.
//
//  a) In una finestra in incognito la scelta vive solo in RAM (giusto: nessuna
//     traccia). Ma se si può DARE si deve poter TOGLIERE: chi ha consentito la
//     fotocamera per sbaglio deve poter tornare indietro senza chiudere la
//     finestra. Il tasto destro sulla scheda e le Impostazioni leggono solo le
//     scelte scritte su disco, quindi in incognito non mostrano niente.
//  b) Una pagina che chiede sei permessi di fila mette in fila sei domande, una
//     dopo l'altra: quante ne restano da smaltire, e si riesce a uscirne?

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0">
<p id="p">pagina</p>
<script>
  window.__cam = () => { window.__camR = navigator.mediaDevices.getUserMedia({ video: true })
    .then(() => 'ok', (e) => (e && e.name) ? e.name : 'errore'); };
  window.__raffica = () => {
    navigator.mediaDevices.getUserMedia({ video: true }).catch(() => {});
    navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
    navigator.geolocation.getCurrentPosition(() => {}, () => {});
    Notification.requestPermission().catch(() => {});
    try { navigator.clipboard.readText().catch(() => {}); } catch (_) {}
  };
  window.__stato = async (n) => {
    try { return (await navigator.permissions.query({ name: n })).state; } catch (_) { return 'n/d'; }
  };
</script>
</body></html>`;

test('in incognito la scelta si può dare ma non togliere', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);

  // Finestra in incognito, con dentro la pagina di prova.
  const url = testServer.html(HTML);
  const info = await app.evaluate(async ({ BrowserWindow }, u) => {
    const { createIncognitoWindow } = require('./src/main/window.js');
    const w = await createIncognitoWindow();
    await new Promise((r) => setTimeout(r, 600));
    w._filoTabs.openTab(u);
    await new Promise((r) => setTimeout(r, 1500));
    void BrowserWindow;
    return { id: w.id, incognito: !!w._filoIncognito, schede: w._filoTabs.tabs.length };
  }, url);
  expect(info.incognito).toBe(true);

  const shellIncognito = app.windows().find((w) => {
    try { return w.url().includes('shell.html?incognito=1'); } catch (_) { return false; }
  });
  expect(shellIncognito, 'shell della finestra incognito non trovata').toBeTruthy();
  const page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
  expect(page, 'pagina nella finestra incognito non trovata').toBeTruthy();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  await page.evaluate(() => window.__cam());
  await expect(shellIncognito.locator('.perm-chip')).toHaveCount(1, { timeout: 10_000 });
  await shellIncognito.locator('.perm-chip .perm-chip-allow').click();
  await expect.poll(() => page.evaluate(() => window.__stato('camera')), { timeout: 8000 }).toBe('granted');

  // Ora: si può togliere? Le due strade che Filo offre per rivedere una scelta.
  const origine = new URL(url).origin;
  const dalTastoDestro = await shellIncognito.evaluate(
    (o) => window.filoShell.permissions.forOrigin(o), origine,
  );
  const suDisco = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  // eslint-disable-next-line no-console
  console.log('[586] incognito — tasto destro:', JSON.stringify(dalTastoDestro), 'impostazioni:', JSON.stringify(suDisco));

  expect(
    (dalTastoDestro && dalTastoDestro.voci || []).length,
    'in incognito la fotocamera è stata consentita ma né il tasto destro sulla scheda né le Impostazioni '
    + 'mostrano la scelta: non c\'è modo di tornare indietro se non chiudendo la finestra',
  ).toBeGreaterThan(0);
});

test('una pagina che chiede tutto insieme: quante domande restano in fila', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, HTML);

  await page.evaluate(() => window.__raffica());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 10_000 });

  // Si smaltisce la fila con la ×, contando quante volte bisogna premere.
  let giri = 0;
  while (giri < 12) {
    const n = await shell.locator('.perm-chip').count();
    if (!n) break;
    await shell.locator('.perm-chip .perm-chip-x').first().click();
    await shell.waitForTimeout(250);
    giri += 1;
  }
  // eslint-disable-next-line no-console
  console.log('[586] domande da smaltire dopo una raffica:', giri);
  expect(await shell.locator('.perm-chip').count(), 'la fila non si svuota').toBe(0);
});
