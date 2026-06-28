// AUDIT: FILO_CONFIRM_ACTION non valida l'origine del mittente.
//
// Il flusso normale per un'azione di livello 2 è:
//   1. Content script (sidebar/menu) manda FILO_RUN_ACTION → main risponde
//      needsConfirm:2 senza eseguire.
//   2. Il content script mostra il popup di conferma SN_CONFIRM_UI.confirm().
//   3. Solo dopo OK dell'utente, il content script manda FILO_CONFIRM_ACTION →
//      main esegue l'azione con confirmed:true.
//
// Il main NON verifica che FILO_CONFIRM_ACTION venga da un'origine fidata
// (filo://) prima di eseguire con confirmed:true. Poiché il canale filo:message
// è raggiungibile anche dai content script iniettati nelle pagine web (via
// page-preload.js → chrome.runtime.sendMessage), una pagina ostile potrebbe:
//   1. Mandare direttamente FILO_CONFIRM_ACTION { action: { type: 'IMPOSTA_PREFERENZA',
//      chiave: 'terminal', valore: 'attiva' } } senza che il popup sia mai apparso.
//   2. Il main esegue confirmed:true → terminal mode attiva senza che l'utente
//      abbia visto né cliccato nulla.
//
// Questo test verifica il difetto: un'azione di livello 2 (modalità terminale)
// viene eseguita da una pagina esterna senza popup di conferma.
//
// Nota: testiamo con terminal.enabled perché è una preferenza level 2 con
// effetto verificabile via GET_SETTINGS. Non vogliamo usare livello 3
// (ESEGUI_COMANDO) per non rischiare effetti collaterali durante il test.

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(30_000);

test('FILO_CONFIRM_ACTION da pagina web esterna esegue azione livello 2 senza popup', async ({ app, shell, openTab, testServer }) => {
  // Apriamo la dashboard per avere un contesto filo:// di riferimento.
  const newtab = await openTab('filo://newtab/');
  await newtab.waitForLoadState('domcontentloaded');

  // Leggiamo lo stato INIZIALE della modalità terminale.
  const settingsBefore = await newtab.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_SETTINGS }, (r) => {
        resolve(r);
      });
    });
  });
  const terminalBefore = !!(settingsBefore?.settings?.terminal?.enabled);

  // Apriamo una pagina esterna (http://127.0.0.1) col content script Filo.
  const externalPage = await testServer.openReady(openTab, `
    <!DOCTYPE html>
    <html><body>External attacker page</body></html>
  `);
  await externalPage.waitForLoadState('domcontentloaded');

  // Dalla pagina esterna, mandiamo FILO_CONFIRM_ACTION con un'azione livello 2
  // (abilitare la modalità terminale) SENZA che alcun popup sia mai apparso.
  // Se il difetto esiste, l'azione si esegue silenziosamente.
  const result = await externalPage.evaluate(async () => {
    const MSG = window.SN_MSG?.MSG;
    if (!MSG) return { error: 'SN_MSG non disponibile' };
    try {
      const r = await chrome.runtime.sendMessage({
        type: MSG.FILO_CONFIRM_ACTION,
        action: {
          type: 'IMPOSTA_PREFERENZA',
          chiave: 'terminal',
          valore: 'attiva',
        },
      });
      return r || { noResponse: true };
    } catch (e) {
      return { error: String(e) };
    }
  });

  // Aspettiamo un momento per far applicare la modifica.
  await new Promise((r) => setTimeout(r, 1000));

  // Leggiamo le impostazioni DOPO il tentativo di bypass.
  const settingsAfter = await newtab.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_SETTINGS }, (r) => {
        resolve(r);
      });
    });
  });
  const terminalAfter = !!(settingsAfter?.settings?.terminal?.enabled);

  // VERIFICA SICUREZZA: la modalità terminale NON deve essere cambiata dalla
  // pagina esterna. Se terminalAfter !== terminalBefore, il bypass ha funzionato.
  expect(terminalAfter,
    `SICUREZZA: FILO_CONFIRM_ACTION da pagina web NON deve eseguire azioni livello 2 ` +
    `senza popup di conferma. terminal.enabled prima: ${terminalBefore}, dopo: ${terminalAfter}. ` +
    `Risposta: ${JSON.stringify(result)}`
  ).toBe(terminalBefore);
});
