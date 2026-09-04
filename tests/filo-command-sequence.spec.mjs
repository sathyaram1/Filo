// FEEDBACK (alpha): "filo non può fare più comandi in sequenza. invece dovrebbe
// venir chiamato nuovamente dopo un comando finché filo non decide che ha
// terminato il compito. ovviamente quando tenta di fare qualcosa di rischioso
// c'è il popup."
//
// Contratto (asserisce il SUCCESSO della feature, non l'assenza di un errore):
//   • dopo che Filo ha ESEGUITO un comando da terminale (livello 1, output
//     reale), la chat lo richiama DA SOLA con l'output, senza che l'utente
//     riscriva: il modello viene interrogato più volte di fila in un solo invio;
//   • Filo "ha finito" quando risponde senza più comandi: a quel punto il loop
//     si ferma e la parola torna all'utente;
//   • un comando rischioso (livello ≥ 2) NON fa proseguire da solo: resta in
//     attesa di conferma (popup) e il loop si ferma.
//
// Pre-condizione che senza il fix fallirebbe: prima la dashboard faceva UN solo
// turno per invio (il modello veniva chiamato una volta), quindi dopo un comando
// la parola tornava sempre all'utente — il secondo turno (e la bolla "FATTO")
// non sarebbero mai comparsi senza un nuovo messaggio.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Conferma un'azione sospesa (qui: attiva la modalità terminale, livello 2).
const confirmAction = (page, action) =>
  page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);

const enableTerminal = (page) =>
  confirmAction(page, { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' });

// Config deterministica con chiave presente + stub del provider che ritorna una
// SEQUENZA di risposte: il turno N decide cosa Filo emette. Un contatore globale
// (`__filoTurnCount`) registra quante volte il modello è stato interrogato in un
// singolo invio dell'utente — è la prova che il loop autonomo ha richiamato Filo.
async function stubSequence(app, turns) {
  await app.evaluate(async (_electron, { turns }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.__filoTurnCount = 0;
    // Tieni la sequenza su globalThis: lo stub la legge da lì (un closure sul
    // parametro `turns` non sopravvive in modo affidabile oltre evaluate()).
    globalThis.__filoTurns = turns;
    // La chat della dashboard chiede il ragionamento in diretta → ogni turno di
    // chat passa dal cammino in STREAMING: lo stub qui SERVE la sequenza e conta
    // i turni reali della conversazione.
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      const seq = globalThis.__filoTurns;
      const n = globalThis.__filoTurnCount;
      globalThis.__filoTurnCount += 1;
      const payload = seq[Math.min(n, seq.length - 1)];
      return {
        text: JSON.stringify(payload),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
    // Gli agenti in background (lezioni/compattatore) usano il cammino NON
    // streaming: rispondiamo qualcosa di innocuo senza toccare il contatore dei
    // turni di chat, così non inquinano la misura dell'auto-continuazione.
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
  }, { turns });
}

const turnCount = (app) => app.evaluate(() => globalThis.__filoTurnCount);

test('Filo prosegue da solo dopo un comando, fino a dichiararsi concluso', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);

  // Turno 1: esegue un comando di sola lettura (livello 1 → eseguito subito).
  // Turno 2: nessun comando + testo sentinella → Filo ha finito, il loop si ferma.
  await stubSequence(app, [
    { text: 'Eseguo il primo passo.', actions: [{ type: 'ESEGUI_COMANDO', comando: 'echo PASSO_UNO_OK' }] },
    { text: 'FATTO_SENTINELLA: ho concluso il compito.', actions: [] },
  ]);

  await page.locator('#input').fill('naviga le cartelle e dimmi cosa trovi');
  await page.locator('#sendBtn').click();

  // SUCCESSO: la bolla finale del SECONDO turno compare SENZA che l'utente abbia
  // riscritto nulla → Filo è stato richiamato da solo dopo il comando.
  await expect(page.locator('.dash-bubble-filo', { hasText: 'FATTO_SENTINELLA' }))
    .toBeVisible({ timeout: 15_000 });
  // L'output del comando del primo passo è davvero comparso in chat.
  await expect(page.locator('.dash-cmd-output', { hasText: 'PASSO_UNO_OK' }))
    .toHaveCount(1); // #521: l'esito vive nella cronologia del blocco di attività, chiusa di default

  // Il modello è stato interrogato DUE volte in un solo invio (1 comando + 1
  // chiusura): la prova dell'auto-continuazione. E l'utente ha una sola bolla.
  expect(await turnCount(app)).toBe(2);
  await expect(page.locator('.dash-bubble-user')).toHaveCount(1);
});

test('un comando rischioso NON prosegue da solo: si ferma in attesa di conferma', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);

  // Turno 1: comando livello 2 (mkdir) → resta in attesa di conferma, NON
  // eseguito. Il loop deve fermarsi qui. Il turno 2 (se mai raggiunto)
  // produrrebbe la sentinella: se compare, il loop NON si è fermato (bug).
  await stubSequence(app, [
    { text: 'Provo a creare una cartella.', actions: [{ type: 'ESEGUI_COMANDO', comando: 'mkdir cartella_test_xyz' }] },
    { text: 'NON_DEVO_COMPARIRE', actions: [] },
  ]);

  await page.locator('#input').fill('crea una cartella');
  await page.locator('#sendBtn').click();

  // Compare il bottone di conferma del comando rischioso (popup in sospeso).
  await expect(page.locator('.dash-action-btn', { hasText: 'mkdir cartella_test_xyz' }))
    .toBeVisible({ timeout: 15_000 });

  // Il loop si è fermato al primo turno: il modello è stato interrogato UNA volta
  // sola e la sentinella del turno 2 NON è comparsa.
  expect(await turnCount(app)).toBe(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'NON_DEVO_COMPARIRE' }))
    .toHaveCount(0);
});
