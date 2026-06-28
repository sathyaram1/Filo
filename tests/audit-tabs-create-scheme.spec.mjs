// Audit spec: verifica che l'apertura di tab con schemi pericolosi (file://)
// venga bloccata. Superficie: tabs:open (usato dalla shell via filoShell.tabs.open)
// e _tabs:create (usato dallo shim chrome.tabs.create delle pagine web).
//
// Senza difesa, una pagina filo:// con XSS o un'iniezione nel contenuto
// potrebbe aprire file:// (leak hash NTLM via SMB su Windows) o javascript:.
// Il finding: né tabs:open né _tabs:create validano lo schema URL prima di
// passarlo a openTab → loadURL.

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(30_000);

test('tabs:open dalla shell con file:// non apre un tab file://', async ({ app, shell }) => {
  await shell.waitForLoadState('domcontentloaded');

  // Contiamo le finestre prima del tentativo
  const winsBefore = app.windows().length;

  // La shell espone filoShell.tabs.open(url) → IPC tabs:open → openTab(url) senza validazione.
  // Simuliamo un attacco: scriviamo una chiamata diretta all'API della shell.
  try {
    await shell.evaluate(async () => {
      // filoShell è esposto dalla shell-preload (contextBridge) ed è accessibile
      // dal main world della shell (BrowserWindow, non WebContentsView esterna).
      if (window.filoShell && window.filoShell.tabs) {
        await window.filoShell.tabs.open('file:///etc/passwd');
      }
    });
  } catch (_) {
    // Ignoriamo errori di evaluate (la chiamata può rigettare se bloccata)
  }

  // Aspettiamo un momento per vedere se si apre un nuovo tab
  await new Promise(r => setTimeout(r, 1500));

  // VERIFICA: nessuna finestra deve avere URL file://
  const fileTabOpened = app.windows().some(w => {
    try { return w.url().startsWith('file://'); } catch (_) { return false; }
  });

  // Se fileTabOpened è true → il finding è confermato: la difesa manca.
  // Il test DEVE PASSARE (false) se la difesa esiste, FALLIRE (true) se manca.
  expect(fileTabOpened).toBe(false);
});

test('tabs:navigate dalla shell con file:// non naviga a file://', async ({ app, shell }) => {
  await shell.waitForLoadState('domcontentloaded');

  // Recuperiamo l'id del primo tab aperto (newtab)
  const snapshot = await shell.evaluate(() =>
    window.filoShell && window.filoShell.tabs ? window.filoShell.tabs.snapshot() : null
  );
  if (!snapshot || !snapshot.tabs || !snapshot.tabs.length) {
    test.skip();
    return;
  }
  const firstTabId = snapshot.tabs[0].id;

  // Tentiamo di navigare il tab corrente a file://
  try {
    await shell.evaluate(async (tabId) => {
      if (window.filoShell && window.filoShell.tabs) {
        await window.filoShell.tabs.navigate(tabId, 'file:///etc/passwd');
      }
    }, firstTabId);
  } catch (_) {}

  await new Promise(r => setTimeout(r, 1500));

  // VERIFICA: nessuna finestra deve avere URL file://
  const fileTabOpened = app.windows().some(w => {
    try { return w.url().startsWith('file://'); } catch (_) { return false; }
  });

  expect(fileTabOpened).toBe(false);
});
