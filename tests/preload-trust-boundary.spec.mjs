// Confine di fiducia preload ↔ origine.
//
// Invariante di sicurezza: il contenuto WEB non deve MAI ricevere le API
// privilegiate di Filo (window.filo + chrome.storage.local, che danno accesso a
// chiavi API e a tutti i dati salvati). Vale anche se il sito viene raggiunto
// navigando IN-PLACE la scheda interna (newtab) verso un URL esterno — il
// vettore di esfiltrazione descritto nell'analisi di sicurezza: il preload è
// fissato alla creazione della WebContentsView, quindi senza difese una
// navigazione in-place farebbe girare un sito esterno col preload privilegiato.
//
// Doppia difesa esercitata qui:
//   1) tabs.js ricrea la view col preload corretto quando si attraversa il
//      confine di fiducia (navigate / will-navigate → _recreateView);
//   2) internal-preload.js non espone nulla se location.protocol !== 'filo:'.
//
// I test ASSERISCONO il successo della difesa (API assenti sul web) e, come
// controprova, che la pagina interna fidata le API ce le ha davvero (altrimenti
// gli altri assert sarebbero falsi positivi).

import { test, expect } from './fixtures/electron.mjs';

function findByHostname(app, host) {
  return app.windows().find((w) => {
    try { return new URL(w.url()).hostname === host; } catch (_) { return false; }
  });
}

async function waitForHostname(app, host, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const page = findByHostname(app, host);
    if (page) return page;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// Sonde nel MAIN world della pagina (Playwright valuta lì di default).
const probeFilo = () => typeof window.filo;
const probeStorageGet = () =>
  typeof (window.chrome && window.chrome.storage && window.chrome.storage.local
    && window.chrome.storage.local.get);

test.describe('confine di fiducia preload ↔ origine', () => {
  test('controprova: la pagina interna (newtab) ESPONE window.filo e chrome.storage', async ({ shell, app }) => {
    const newtab = await waitForHostname(app, 'newtab');
    expect(newtab, 'window della newtab interna').toBeTruthy();
    await newtab.waitForLoadState('domcontentloaded').catch(() => {});
    expect(await newtab.evaluate(probeFilo)).toBe('object');
    expect(await newtab.evaluate(probeStorageGet)).toBe('function');
  });

  test('un sito esterno aperto in NUOVA scheda non riceve le API privilegiate', async ({ openTab, testServer }) => {
    const url = testServer.html('<!doctype html><meta charset="utf-8"><title>ext</title><body>hello</body>');
    const page = await openTab(url);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    expect(await page.evaluate(probeFilo), 'window.filo assente su sito esterno').toBe('undefined');
    expect(await page.evaluate(probeStorageGet), 'chrome.storage.local.get assente su sito esterno').toBe('undefined');
  });

  test('navigare IN-PLACE la newtab interna verso un sito esterno NON espone le API', async ({ shell, app, testServer }) => {
    const url = testServer.html('<!doctype html><meta charset="utf-8"><title>evil</title><body>evil</body>');
    const host = new URL(url).hostname;

    // Scheda interna attiva (la newtab di boot).
    const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
    const internalTab = snap.tabs.find((t) => t.isInternal) || snap.tabs[0];
    expect(internalTab, 'scheda interna nello snapshot').toBeTruthy();

    // Vettore d'attacco: navigazione IN-PLACE della STESSA scheda verso il web.
    await shell.evaluate(
      ({ id, u }) => window.filoShell.tabs.navigate(id, u),
      { id: internalTab.id, u: url },
    );

    const page = await waitForHostname(app, host);
    expect(page, 'window del sito esterno dopo la navigazione in-place').toBeTruthy();
    await page.waitForLoadState('domcontentloaded').catch(() => {});

    // L'esfiltrazione descritta nell'analisi: senza fix qui window.filo sarebbe
    // un oggetto e chrome.storage.local.get una funzione → leggibile dal sito.
    expect(await page.evaluate(probeFilo), 'window.filo NON deve esistere sul sito esterno').toBe('undefined');
    expect(await page.evaluate(probeStorageGet), 'chrome.storage.local.get NON deve esistere sul sito esterno').toBe('undefined');

    // Controprova positiva: il sito gira col preload web corretto (i content
    // script di page-preload si montano e segnano data-filo-ready), quindi le
    // funzioni di Filo sul web continuano a funzionare (nessuna regressione).
    await page.waitForFunction(
      () => document.documentElement.dataset.filoReady === '1',
      null,
      { timeout: 8000 },
    ).catch(() => {});
    expect(await page.evaluate(() => document.documentElement.dataset.filoReady)).toBe('1');
  });
});
