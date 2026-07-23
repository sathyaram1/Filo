// AUDIT: MSG.QUIT_APP e MSG.CLOSE_ALL_TABS non validano l'origine del mittente.
//
// Il canale 'filo:message' è raggiungibile sia dalle pagine interne filo://
// sia dai content script delle pagine web esterne (via page-preload.js che
// espone chrome.runtime.sendMessage). Il main registra QUIT_APP e CLOSE_ALL_TABS
// senza controllare se il mittente è una pagina filo:// o una pagina web
// esterna — quindi una pagina web qualsiasi potrebbe:
//   - QUIT_APP → chiudere l'intera app (DoS: perdita di tutto il lavoro aperto)
//   - CLOSE_ALL_TABS → chiudere tutte le schede dell'utente (DoS locale)
//
// Questo test esercita il flusso reale: apre una pagina web su 127.0.0.1
// (che riceve il preload con chrome.runtime.sendMessage), invia CLOSE_ALL_TABS
// e verifica che i tab NON vengano chiusi. QUIT_APP viene inviato ma è difficile
// da verificare in modo deterministico senza abbattere il processo di test;
// la superficie è comunque la stessa mancanza di controllo origine.
//
// Nota: QUIT_APP non viene esercitato con assert di "app non è morta" perché
// abbatterebbe l'ElectronApplication e renderebbe il test non isolato.
// Si usa CLOSE_ALL_TABS come proxy del problema (stesso handler, stesso difetto).

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(30_000);

// Gate d'origine deterministico direttamente sul dispatch del main (#250): un
// mittente con origine web esterna riceve `forbidden` da CLOSE_ALL_TABS e
// QUIT_APP; un mittente filo:// passa. Non dipende dalla disponibilità di
// chrome.runtime nella pagina esterna: esercita l'handler reale col mittente
// sintetico. Se qualcuno togliesse il check isFilo, questo test diventa rosso.
const dispatch = (app, msg, sender) =>
  app.evaluate((_electron, { msg, sender }) =>
    globalThis.SN_HANDLE_MESSAGE(msg, sender), { msg, sender });

test('CLOSE_ALL_TABS / QUIT_APP: origine web esterna → forbidden, origine filo:// → consentita', async ({ app }) => {
  const web = { tab: { id: 7, url: 'http://evil.example/' }, url: 'http://evil.example/' };
  const filo = { tab: { id: 8, url: 'filo://newtab/' }, url: 'filo://newtab/' };

  // Esterna → rifiutata (l'app NON esegue né chiude nulla).
  const closeWeb = await dispatch(app, { type: 'close_all_tabs' }, web);
  expect(closeWeb.ok).toBe(false);
  expect(closeWeb.error).toBe('forbidden');
  const quitWeb = await dispatch(app, { type: 'quit_app' }, web);
  expect(quitWeb.ok).toBe(false);
  expect(quitWeb.error).toBe('forbidden');

  // filo:// → il gate lascia passare (winOf è nullo col mittente sintetico, quindi
  // non chiude davvero le schede: asseriamo solo che il gate NON blocca).
  const closeFilo = await dispatch(app, { type: 'close_all_tabs' }, filo);
  expect(closeFilo.ok).toBe(true);
  // QUIT_APP da filo:// non lo invochiamo qui: abbatterebbe l'app di test.
});

test('CLOSE_ALL_TABS da pagina web esterna non chiude tutte le schede', async ({ app, shell, openTab, testServer }) => {
  // Apriamo una scheda filo:// (la newtab) — questa deve sopravvivere.
  const newtab = await openTab('filo://newtab/');
  await newtab.waitForLoadState('domcontentloaded');

  // Contiamo le schede PRIMA dell'attacco.
  const snapshotBefore = await shell.evaluate(() =>
    window.filoShell?.tabs?.snapshot() || { tabs: [] }
  );
  const tabCountBefore = snapshotBefore.tabs.length;
  expect(tabCountBefore).toBeGreaterThan(0);

  // Apriamo una pagina web su http://127.0.0.1 (origine non filo://).
  // Il page-preload inietta chrome.runtime.sendMessage anche qui.
  const externalPage = await testServer.openReady(openTab, `
    <!DOCTYPE html>
    <html><body>External test page</body></html>
  `);
  await externalPage.waitForLoadState('domcontentloaded');

  // Inviamo CLOSE_ALL_TABS dalla pagina esterna tramite il content script.
  const result = await externalPage.evaluate(async () => {
    const MSG = window.SN_MSG?.MSG;
    if (!MSG) return { error: 'SN_MSG non disponibile nel content script' };
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.CLOSE_ALL_TABS });
      return r || { noResponse: true };
    } catch (e) {
      return { error: String(e) };
    }
  });

  // Aspettiamo un attimo per vedere se i tab vengono chiusi.
  await new Promise((r) => setTimeout(r, 1000));

  // VERIFICA SICUREZZA: il numero di schede NON deve essere sceso a 1 (newtab solitario)
  // come succederebbe se CLOSE_ALL_TABS avesse funzionato.
  const snapshotAfter = await shell.evaluate(() =>
    window.filoShell?.tabs?.snapshot() || { tabs: [] }
  );
  const tabCountAfter = snapshotAfter.tabs.length;

  // Se tabCountAfter è 1 (solo newtab rimasta dopo un close-all) → il bug è confermato.
  // Se è >= tabCountBefore (inclusa la pagina esterna aperta poco fa) → protetto.
  expect(tabCountAfter,
    `SICUREZZA: CLOSE_ALL_TABS da pagina web non-filo:// NON deve chiudere le schede dell'utente. ` +
    `Prima: ${tabCountBefore}, dopo: ${tabCountAfter}`
  ).toBeGreaterThan(1);
});
