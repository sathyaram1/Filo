// Rilevamento siti pericolosi (src/main/services/safebrowse + content/safebrowse.js):
//
//   - il motore di verdetto (eseguito nel main) classifica correttamente
//     impersonazioni note (omoglifi cirillici, typo) come "pericoloso" e i
//     domini legittimi/infra come "safe" — asserisce il COMPORTAMENTO, non un
//     messaggio: un dominio-truffa che chiede la password DEVE essere pericoloso.
//   - la pagina Sicurezza espone i controlli personali e li persiste; la chiave
//     Google Safe Browsing NON è più un campo per-utente: è condivisa (gestita
//     dall'admin in "Modelli predefiniti") e la pagina lo dichiara.
//   - la chiave condivisa, quando presente, raggiunge DAVVERO il motore per tutti
//     gli account (asserisce che lo stadio GSB si accende), senza mai trapelare
//     il valore al renderer admin (solo un booleano "configurata").
//   - l'interstitial "pericoloso" copre DAVVERO la pagina e si toglie solo dopo
//     aver scritto "confermo" → Procedi (asserisce che l'overlay sparisce, cioè
//     che il flusso di bypass funziona, non che un testo sia cambiato).

import { test, expect } from './fixtures/electron.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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

test('pagina Sicurezza: controlli personali default ON e persistenti; nessun campo chiave (è condivisa)', async ({ openTab }) => {
  const page = await openTab('filo://security/');
  await page.waitForSelector('#sec-safebrowse', { timeout: 8_000 });

  // Default: tutto attivo.
  await expect(page.locator('#sec-safebrowse')).toBeChecked();
  await expect(page.locator('#sec-safebrowse-network')).toBeChecked();
  await expect(page.locator('#sec-safebrowse-llm')).toBeChecked();
  await expect(page.locator('#sec-safebrowse-sandbox')).toBeChecked();

  // La chiave NON è più un campo per-utente: il vecchio input è sparito e al suo
  // posto c'è la nota che dice che è gestita centralmente in "Modelli predefiniti".
  await expect(page.locator('#sec-safebrowse-key')).toHaveCount(0);
  const note = page.locator('#sec-safebrowse-key-managed');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Modelli predefiniti');

  // I toggle personali restano e si persistono: spegni il giudizio AI, ricarica.
  await page.locator('#sec-safebrowse-llm').uncheck();
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  await page.reload();
  await page.waitForSelector('#sec-safebrowse', { timeout: 8_000 });
  await expect(page.locator('#sec-safebrowse-llm')).not.toBeChecked();
  await expect(page.locator('#sec-safebrowse')).toBeChecked();
});

test('chiave GSB condivisa: lo store la espone come "presente" senza mai rivelarne il valore', () => {
  // defaultsStore è puro Node (niente Electron): lo carichiamo direttamente.
  const Defaults = require('../src/main/services/defaultsStore.js');

  // Senza override remoto la chiave è vuota (default), ma il CAMPO esiste nel
  // contratto della config condivisa (prima del refactor non c'era affatto).
  const eff = Defaults.get();
  expect(typeof eff.safeBrowsingKey).toBe('string');

  // La vista per l'admin espone SOLO un booleano "configurata/non", MAI il valore.
  const pub = Defaults.getPublicForAdmin();
  expect(pub).toHaveProperty('safeBrowsingKeyPresent');
  expect(typeof pub.safeBrowsingKeyPresent).toBe('boolean');
  expect(Object.prototype.hasOwnProperty.call(pub, 'safeBrowsingKey')).toBe(false);
  // Nessun campo del payload admin contiene per sbaglio una chiave grezza.
  expect(JSON.stringify(pub)).not.toContain('AIza');
});

test('chiave GSB condivisa: quando è impostata raggiunge il motore per TUTTI (stadio GSB acceso)', async ({ app }) => {
  // Simula una chiave condivisa fissata dall'admin (config/secrets su Firestore)
  // sovrascrivendo Defaults.get nel main, poi lascia che la normale catena
  // (getEffectiveSettings → withDefaults → wireSafebrowse) la propaghi al motore.
  const active = await app.evaluate(async () => {
    // In test il main espone i singleton su globalThis (require non è iniettato
    // nello scope di evaluate). Sono le STESSE istanze usate in produzione.
    const Defaults = globalThis.__filoDefaults;
    const handlers = globalThis.__filoHandlers;
    const SB = globalThis.SN_SAFEBROWSE;
    const origGet = Defaults.get;
    try {
      // 1) Senza chiave condivisa: lo stadio GSB resta spento.
      Defaults.get = () => ({ ...origGet(), safeBrowsingKey: '' });
      await handlers.wireSafebrowse();
      const off = SB.activeProviders().gsb;

      // 2) Con la chiave condivisa: si accende per tutti, senza tocco per-utente.
      Defaults.get = () => ({ ...origGet(), safeBrowsingKey: 'TEST-SHARED-GSB-KEY' });
      await handlers.wireSafebrowse();
      const on = SB.activeProviders().gsb;
      return { off, on };
    } finally {
      Defaults.get = origGet;
      await handlers.wireSafebrowse().catch(() => {});
    }
  });

  expect(active.off).toBe(false);
  expect(active.on).toBe(true);
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
