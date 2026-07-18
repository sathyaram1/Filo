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

test('interstitial "pericoloso": "Torna indietro" su scheda nuova NON conferma il sito (#288)', async ({ app, openTab, testServer }) => {
  // Scheda aperta la prima volta su un URL: cronologia vuota (history.length===1).
  // Cliccare "Torna indietro" sull'avviso "pericoloso" deve RIFIUTARE il sito,
  // NON confermarlo: il dominio non deve finire fra i domini bypassati del tab
  // (altrimenti l'avviso non ricomparirebbe più se il sito si ripresenta).
  const page = await testServer.openReady(openTab, '<title>SB_BACK</title><p>contenuto pagina</p>');

  // Pre-condizione del bug: la scheda è nuova, senza pagina precedente.
  expect(await page.evaluate(() => history.length)).toBe(1);

  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        const u = t.view?.webContents?.getURL?.() || '';
        if (!/^https?:/.test(u)) continue;
        t.view.webContents.send('filo:broadcast', {
          type: 'safebrowse_update',
          level: 'pericoloso',
          message: { title: 'Sito pericoloso', body: 'Questo non è PayPal. Ti sta chiedendo la password.' },
        });
      }
    }
  });

  await expect(page.getByText('Sito pericoloso')).toBeVisible({ timeout: 6_000 });

  // Registra id + dominio della scheda esterna PRIMA che navighi via.
  const { tabId, domain } = await app.evaluate(({ BrowserWindow }) => {
    const SB = globalThis.SN_SAFEBROWSE;
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        const u = t.view?.webContents?.getURL?.() || '';
        if (!/^https?:/.test(u)) continue;
        const norm = SB && SB.normalize(u);
        return { tabId: t.id, domain: norm ? norm.registrable : null };
      }
    }
    return { tabId: null, domain: null };
  });
  expect(domain).toBeTruthy();

  // Clic su "Torna indietro": senza cronologia, la scheda deve solo uscire
  // (about:blank) senza inviare alcuna conferma al main.
  await page.getByRole('button', { name: 'Torna indietro' }).click();

  // Aspetta che l'handler sia arrivato in fondo: la scheda naviga ad about:blank
  // in entrambi i casi (bug e fix), quindi è un punto di sincronizzazione sicuro.
  // Nel caso bug, la conferma (bypass) è già stata registrata PRIMA della replace.
  await expect
    .poll(
      async () =>
        app.evaluate(({ BrowserWindow }, id) => {
          for (const w of BrowserWindow.getAllWindows()) {
            if (!w._filoTabs) continue;
            const t = w._filoTabs.tabs.find((x) => x.id === id);
            if (t) return t.view?.webContents?.getURL?.() || '';
          }
          return '';
        }, tabId),
      { timeout: 6_000 },
    )
    .toMatch(/^about:blank$|^$/);

  // ASSERT del successo: il dominio NON è stato bypassato → se il verdetto
  // pericoloso si ripresentasse, l'avviso ricomparirebbe. Prima del fix qui il
  // dominio era presente (stesso effetto di "Procedi comunque").
  const bypassed = await app.evaluate(
    ({ BrowserWindow }, { id, dom }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w._filoTabs) continue;
        const t = w._filoTabs.tabs.find((x) => x.id === id);
        if (t) return !!(t.sbBypass && t.sbBypass.has(dom));
      }
      return false;
    },
    { id: tabId, dom: domain },
  );
  expect(bypassed).toBe(false);
});

test('popup "sospetto": è un popup di conferma e si chiude solo con "Continua" (#176)', async ({ app, openTab, testServer }) => {
  // Pagina esterna reale: di per sé "safe". Iniettiamo il verdetto "sospetto"
  // come fa il main dopo l'analisi (es. il sito casinò del feedback #176).
  const page = await testServer.openReady(openTab, '<title>SB_SUSPECT</title><p>contenuto pagina</p>');

  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        const u = t.view?.webContents?.getURL?.() || '';
        if (!/^https?:/.test(u)) continue;
        t.view.webContents.send('filo:broadcast', {
          type: 'safebrowse_update',
          level: 'sospetto',
          message: { title: 'Sito potenzialmente sospetto', body: 'Chiede credenziali o dati personali su un dominio non ufficiale.' },
        });
      }
    }
  });

  // L'avviso compare come popup di conferma (non più la striscia "Ho capito"):
  // titolo + corpo visibili, e i due pulsanti di scelta esplicita.
  await expect(page.getByText('Sito potenzialmente sospetto')).toBeVisible({ timeout: 6_000 });
  await expect(page.getByText(/credenziali o dati personali/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ho capito' })).toHaveCount(0);
  const proceed = page.getByRole('button', { name: 'Continua' });
  await expect(proceed).toBeVisible();
  await expect(page.getByRole('button', { name: 'Torna indietro' })).toBeVisible();

  // Solo dopo la conferma esplicita ("Continua") il popup sparisce.
  await proceed.click();
  await expect(page.getByText('Sito potenzialmente sospetto')).toHaveCount(0, { timeout: 6_000 });
});
