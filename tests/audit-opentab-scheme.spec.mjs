// AUDIT: gli handler IPC che aprono tab non validano lo schema dell'URL.
//
// Tre percorsi convergono su openTab() senza passare per isWebUnsafeNav():
//   - MSG.OPEN_URL (usato dai content script Filo, es. menuIcons.js)
//   - MSG.OPEN_NEW_TAB (usato dal content script via menuIcons.js)
//   - _tabs:create (shim chrome.tabs.create in page-preload.js)
//
// executeFiloAction('NAVIGA') ha il controllo schema, ma i tre handler sopra no.
//
// Conseguenza: un content script Filo iniettato in una pagina ostile potrebbe
// (tramite prompt-injection o exploit del content script) aprire URL con schema
// non-web (file://, javascript:, ecc.) bypassando le difese in will-navigate
// (che si attiva SOLO per navigazioni in-place, non per loadURL programmatico).
//
// Questo test DOCUMENTA il comportamento attuale da una pagina filo:// interna
// (mittente privilegiato) per isolare il pattern. Riguarda soprattutto i
// content script su pagine esterne: se anche da lì passa, l'attacco surface è
// più ampia. Vedi PARTE TECNICA per i dettagli.

import { test, expect } from './fixtures/electron.mjs';

test('OPEN_URL da pagina interna filo:// non filtra schemi file://', async ({ app, openTab, shell }) => {
  // Apriamo la newtab (pagina interna filo://) e inviamo OPEN_URL con schema file://.
  // Ci aspettiamo che il main process blocci l'apertura di URL con schema non sicuro.
  const newtab = await openTab('filo://newtab/');
  await newtab.waitForLoadState('domcontentloaded');

  // Invia MSG.OPEN_URL con URL file:// dalla pagina interna.
  const testUrl = 'file:///etc/passwd';
  const result = await newtab.evaluate(async (url) => {
    const MSG = window.SN_MSG?.MSG;
    if (!MSG) return { error: 'SN_MSG non disponibile' };
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url });
      return r;
    } catch (e) {
      return { error: String(e) };
    }
  }, testUrl);

  // Verifica che NESSUNA window con URL file:// sia stata aperta.
  await new Promise((r) => setTimeout(r, 500));
  const windows = app.windows();
  const fileWins = windows.filter((w) => {
    try { return w.url().startsWith('file://'); } catch (_) { return false; }
  });

  // BUG CONFERMATO SE: esiste una finestra con URL file://.
  expect(fileWins.length,
    'SICUREZZA: OPEN_URL NON deve aprire schemi file:// (bypassa will-navigate)'
  ).toBe(0);
});

test('_tabs:create (chrome.tabs.create) da pagina interna non filtra schemi file://', async ({ app, openTab }) => {
  // Stesso test ma tramite lo shim chrome.tabs.create (usato dai content script).
  const newtab = await openTab('filo://newtab/');
  await newtab.waitForLoadState('domcontentloaded');

  const testUrl = 'file:///etc/passwd';
  await newtab.evaluate(async (url) => {
    try {
      // chrome.tabs.create in page-preload.js → _tabs:create IPC → openTab()
      if (typeof chrome !== 'undefined' && typeof chrome.tabs?.create === 'function') {
        await chrome.tabs.create({ url });
      }
    } catch (_) {}
  }, testUrl);

  await new Promise((r) => setTimeout(r, 500));
  const windows = app.windows();
  const fileWins = windows.filter((w) => {
    try { return w.url().startsWith('file://'); } catch (_) { return false; }
  });

  // BUG CONFERMATO SE: esiste una finestra con URL file://.
  expect(fileWins.length,
    'SICUREZZA: chrome.tabs.create NON deve aprire schemi file://'
  ).toBe(0);
});

test('OPEN_NEW_TAB con URL file:// viene bloccato', async ({ app, openTab }) => {
  const newtab = await openTab('filo://newtab/');
  await newtab.waitForLoadState('domcontentloaded');

  const testUrl = 'file:///etc/passwd';
  await newtab.evaluate(async (url) => {
    const MSG = window.SN_MSG?.MSG;
    if (!MSG) return;
    try {
      await chrome.runtime.sendMessage({ type: MSG.OPEN_NEW_TAB, url });
    } catch (_) {}
  }, testUrl);

  await new Promise((r) => setTimeout(r, 500));
  const windows = app.windows();
  const fileWins = windows.filter((w) => {
    try { return w.url().startsWith('file://'); } catch (_) { return false; }
  });

  expect(fileWins.length,
    'SICUREZZA: OPEN_NEW_TAB NON deve aprire schemi file://'
  ).toBe(0);
});
