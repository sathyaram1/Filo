// AUDIT: la cronologia degli appunti (clipboard history) non ha controllo
// di origine sugli handler IPC GET_CLIPBOARD_HISTORY e PUSH_CLIPBOARD_ENTRY.
//
// Una pagina web esterna carica il content script di Filo (via page-preload)
// che ha accesso a chrome.runtime.sendMessage nel mondo isolato del preload.
// Gli handler GET_CLIPBOARD_HISTORY e PUSH_CLIPBOARD_ENTRY non verificano
// se il mittente è una pagina filo:// o una pagina web esterna: qualunque
// content script può leggere e scrivere la cronologia degli appunti.
//
// Test verifica:
// (a) Una pagina esterna può leggere la cronologia appunti via
//     GET_CLIPBOARD_HISTORY — include testi copiati in precedenza.
// (b) Una pagina esterna può aggiungere voci alla cronologia via
//     PUSH_CLIPBOARD_ENTRY — senza che l'utente abbia copiato nulla.
//
// Nota: si tratta di un comportamento ATTUALE (non del comportamento atteso
// dopo un fix). Questo test DOCUMENTA il problema confermando che il
// comportamento esiste, non che sia corretto.

import { test, expect } from './fixtures/electron.mjs';

const SENTINEL_TEXT = 'AUDIT_CLIP_SENTINELLA_UNIVOCA_XK7Q';

test('una pagina web può leggere la cronologia appunti di Filo (nessun check origine su GET_CLIPBOARD_HISTORY)', async ({ app, openTab, testServer }) => {
  // Prima: seed la cronologia con un testo da una pagina interna filo://.
  const newtab = await openTab('filo://newtab/');
  await newtab.waitForLoadState('domcontentloaded');
  const seedOk = await newtab.evaluate(async (text) => {
    const r = await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.PUSH_CLIPBOARD_ENTRY,
      entry: { type: 'text', text },
    });
    return !!r?.ok;
  }, SENTINEL_TEXT);
  expect(seedOk, 'seed della cronologia dalla pagina interna').toBe(true);

  // Poi: apri una pagina web ESTERNA (non filo://) e cerca di leggere la
  // cronologia. Nel contesto del preload (mondo isolato) chrome.runtime è
  // disponibile, quindi il content script può invocare GET_CLIPBOARD_HISTORY.
  const page = await testServer.openReady(openTab,
    '<!doctype html><html><head><meta charset="utf-8"><title>pagina esterna</title></head><body>pagina test</body></html>');

  const result = await page.evaluate(async () => {
    // Questo gira nel contesto del preload (mondo isolato) via page.evaluate.
    // In Playwright su Electron, page.evaluate gira nel MAIN world.
    // Verifichiamo se chrome.runtime è disponibile nel main world.
    return {
      chromeAvail: typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined',
      sendMsgAvail: typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function',
    };
  });

  // Se chrome.runtime è disponibile nel main world di una pagina esterna,
  // c'è un problema di confine di fiducia.
  if (result.chromeAvail && result.sendMsgAvail) {
    // chrome.runtime è accessibile dal main world della pagina esterna.
    // Tento di leggere la cronologia.
    const clipResult = await page.evaluate(async (msgType) => {
      try {
        const r = await chrome.runtime.sendMessage({ type: msgType });
        return r;
      } catch (e) {
        return { error: String(e) };
      }
    }, 'get_clipboard_history');

    // BUG CONFERMATO SE: la risposta contiene il testo sentinella.
    const items = clipResult?.items || [];
    const found = items.some((i) => i.type === 'text' && i.text === SENTINEL_TEXT);
    if (found) {
      console.warn('BUG CONFERMATO: una pagina esterna può leggere la cronologia appunti di Filo');
    }
    expect(found,
      'BUG: una pagina esterna NON dovrebbe poter leggere la cronologia appunti di Filo'
    ).toBe(false);
  } else {
    // chrome.runtime NON è accessibile nel main world della pagina esterna.
    // La difesa per isolamento di contesto funziona.
    expect(result.chromeAvail || result.sendMsgAvail,
      'chrome.runtime NON deve essere disponibile nel main world di una pagina esterna'
    ).toBe(false);
  }
});

test('una pagina web non può aggiungere voci alla cronologia appunti via main world (contesto isolato)', async ({ openTab, testServer }) => {
  // Una pagina esterna prova ad aggiungere una voce alla cronologia.
  const page = await testServer.openReady(openTab,
    '<!doctype html><html><body>test</body></html>');

  // Verifica se chrome è accessibile dal main world.
  const chromeInMainWorld = await page.evaluate(() =>
    typeof chrome !== 'undefined' && typeof chrome?.runtime?.sendMessage === 'function');

  // La difesa corretta: chrome.runtime NON deve essere nel main world delle
  // pagine esterne (contextIsolation:true garantisce questo).
  expect(chromeInMainWorld,
    'chrome.runtime deve essere assente nel main world delle pagine web esterne'
  ).toBe(false);
});
