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

test('una pagina web non può aggiungere voci alla cronologia appunti via main world (contesto isolato)', async ({ app, openTab, testServer }) => {
  // Dal #1616 ogni pagina http(s) vede un window.chrome come in Chrome, runtime.sendMessage e runtime.connect compresi
  // (preload/mondo-chrome.js): la difesa non è più «chrome.runtime manca», è che quella porta non arriva a Filo.
  const page = await testServer.openReady(openTab,
    '<!doctype html><html><body>test</body></html>');
  const INTRUSA = 'AUDIT_CLIP_INTRUSA_DAL_SITO_XK7Q';
  const tipo = await app.evaluate(() => globalThis.SN_MSG.MSG.PUSH_CLIPBOARD_ENTRY);

  // Tutte le forme con cui uno script di pagina può provare a mandare un messaggio: nessuna risponde come Filo.
  const esiti = await page.evaluate(async ({ tipo, testo }) => {
    const msg = { type: tipo, entry: { type: 'text', text: testo } };
    const id = 'a'.repeat(32);
    const out = {};
    const tenta = async (nome, fn) => {
      try { out[nome] = JSON.stringify(await fn()) ?? 'undefined'; } catch (e) { out[nome] = 'throw: ' + String(e.message).slice(0, 80); }
    };
    await tenta('senzaId', () => chrome.runtime.sendMessage(msg));
    await tenta('conId', () => chrome.runtime.sendMessage(id, msg));
    await tenta('callback', () => new Promise((r) => chrome.runtime.sendMessage(id, msg, r)));
    await tenta('porta', () => new Promise((r) => {
      const p = chrome.runtime.connect(id);
      p.onMessage.addListener((m) => r({ risposta: m }));
      p.onDisconnect.addListener(() => r('chiusa'));
      p.postMessage(msg);
    }));
    return out;
  }, { tipo, testo: INTRUSA });
  for (const [nome, esito] of Object.entries(esiti)) {
    expect(esito, `${nome}: la pagina non deve ricevere una risposta di Filo`).not.toContain('"ok":true');
  }

  // E la cronologia, letta dal main, non ha la voce: è questo che conta per chi apre «Incolla».
  const items = await app.evaluate(() => globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []));
  expect(items.some((i) => i && i.type === 'text' && i.text === INTRUSA),
    'una voce scritta da uno script di pagina è finita nella cronologia appunti'
  ).toBe(false);
});
