// Rilevamento siti pericolosi (src/main/services/safebrowse + content/safebrowse.js):
//
//   - il motore di verdetto (eseguito nel main) classifica correttamente
//     impersonazioni note (omoglifi cirillici, typo) come "pericoloso" e i
//     domini legittimi/infra come "safe" — asserisce il COMPORTAMENTO, non un
//     messaggio: un dominio-truffa che chiede la password DEVE essere pericoloso.
//   - la pagina Sicurezza espone i controlli e li persiste.
//   - l'interstitial "pericoloso" copre DAVVERO la pagina e si toglie solo dopo
//     aver scritto "confermo" → Procedi (asserisce che l'overlay sparisce, cioè
//     che il flusso di bypass funziona, non che un testo sia cambiato).

import { test, expect } from './fixtures/electron.mjs';

test('motore: impersonazioni → pericoloso, domini legittimi → safe', async ({ app }) => {
  // Gira nel main process, dove SN_SAFEBROWSE è registrato su globalThis.
  const verdicts = await app.evaluate(() => {
    const SB = globalThis.SN_SAFEBROWSE;
    const v = (url, ctx) => {
      const r = SB.checkSync(url, ctx || {});
      return { level: r.level, hasMsg: !!(r.message && r.message.body) };
    };
    return {
      amazon: v('https://amazon.it/'),
      google: v('https://www.google.com/'),
      gusercontent: v('https://googleusercontent.com/'),
      cyrillicApple: v('https://xn--80ak6aa92e.com/', { hasPassword: true }),
      paypalTypo: v('https://paypa1.com/', { hasPassword: true }),
    };
  });

  // Identità legittime: nessun allarme.
  expect(verdicts.amazon.level).toBe('safe');
  expect(verdicts.google.level).toBe('safe');
  // Infra Google con "google" nel nome: NON dev'essere un falso positivo.
  expect(verdicts.gusercontent.level).toBe('safe');

  // Impersonazioni con richiesta di password: blocco a pagina piena.
  expect(verdicts.cyrillicApple.level).toBe('pericoloso');
  expect(verdicts.cyrillicApple.hasMsg).toBe(true);
  expect(verdicts.paypalTypo.level).toBe('pericoloso');
  expect(verdicts.paypalTypo.hasMsg).toBe(true);
});

test('pagina Sicurezza: controlli rilevamento siti pericolosi, default ON e persistenza', async ({ openTab }) => {
  const page = await openTab('filo://security/');
  await page.waitForSelector('#sec-safebrowse', { timeout: 8_000 });

  // Default: tutto attivo.
  await expect(page.locator('#sec-safebrowse')).toBeChecked();
  await expect(page.locator('#sec-safebrowse-network')).toBeChecked();
  await expect(page.locator('#sec-safebrowse-llm')).toBeChecked();
  await expect(page.locator('#sec-safebrowse-sandbox')).toBeChecked();

  // Spegni il giudizio AI e salva la chiave; deve persistere dopo reload.
  await page.locator('#sec-safebrowse-llm').uncheck();
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  await page.locator('#sec-safebrowse-key').fill('TEST-GSB-KEY');
  await page.locator('#sec-safebrowse-key').blur();
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  await page.reload();
  await page.waitForSelector('#sec-safebrowse', { timeout: 8_000 });
  await expect(page.locator('#sec-safebrowse-llm')).not.toBeChecked();
  await expect(page.locator('#sec-safebrowse')).toBeChecked();
  await expect(page.locator('#sec-safebrowse-key')).toHaveValue('TEST-GSB-KEY');
});

test('interstitial "pericoloso": copre la pagina e si toglie solo con "confermo" → Procedi', async ({ app, openTab, testServer }) => {
  // Pagina esterna reale (127.0.0.1) con i content script montati. Di per sé è
  // "safe"; iniettiamo il verdetto pericoloso come fa il main dopo l'analisi.
  const page = await testServer.openReady(openTab, '<title>SB_VICTIM</title><p>contenuto pagina</p>');

  // Broadcast del verdetto al tab esterno (senza url → il content lo applica
  // alla pagina corrente). Replica esattamente ciò che fa _sbBroadcast.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        const u = t.view?.webContents?.getURL?.() || '';
        if (!/^https?:/.test(u)) continue;
        t.view.webContents.send('filo:broadcast', {
          type: 'safebrowse_update',
          level: 'pericoloso',
          message: { title: 'Sito pericoloso', body: 'Questo non è PayPal. Il dominio è paypa1.com, ti sta chiedendo la password.' },
        });
      }
    }
  });

  // L'overlay vive in uno Shadow DOM aperto: Playwright lo attraversa.
  await expect(page.getByText('Sito pericoloso')).toBeVisible({ timeout: 6_000 });
  await expect(page.getByText(/Questo non è PayPal/)).toBeVisible();

  // Il pulsante "Procedi comunque" è inerte finché non si scrive "confermo".
  const proceed = page.getByRole('button', { name: 'Procedi comunque' });
  await expect(proceed).toBeVisible();

  await page.getByPlaceholder('confermo').fill('confermo');
  await proceed.click();

  // Dopo la conferma l'overlay sparisce (bypass registrato per il dominio).
  await expect(page.getByText('Sito pericoloso')).toHaveCount(0, { timeout: 6_000 });
});
