// #250 — Controparte legittima di audit-confirm-bypass.
//
// La difesa in profondità su FILO_CONFIRM_ACTION NON deve rompere l'agente
// on-page ("Aiuto"): sulle pagine web ESTERNE la sidebar può eseguire azioni di
// livello 2 (es. inviare un feedback agli sviluppatori) passando per il giro
// legittimo RUN → popup di conferma → CONFIRM. Solo il CONFIRM "a freddo" (senza
// il RUN che lo precede) da un'origine esterna viene rifiutato.
//
// Questo spec asserisce il SUCCESSO del cammino legittimo: da un'origine esterna,
// FILO_RUN_ACTION (livello 2 → needsConfirm, niente esecuzione) seguito da
// FILO_CONFIRM_ACTION della STESSA azione esegue davvero. E verifica che la
// conferma è ONE-TIME: un secondo CONFIRM senza un nuovo RUN è rifiutato.
//
// Se qualcuno "semplificasse" il gate a un semplice isFilo(origin), questo test
// diventerebbe rosso (l'agente on-page smetterebbe di funzionare sulle pagine web).

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(30_000);

test('on-page agent (origine esterna): RUN→CONFIRM esegue un\'azione livello 2; il CONFIRM a freddo no', async ({ app, openTab, testServer }) => {
  // Stub del submit feedback nel main: registra le chiamate senza toccare la rete.
  await app.evaluate(() => {
    const FB = globalThis.SN_FEEDBACK;
    globalThis.__origFbSubmit = FB.submit;
    globalThis.__fbCalls = [];
    FB.submit = async (payload) => { globalThis.__fbCalls.push(payload); return { id: 'test-fb' }; };
  });

  const page = await testServer.openReady(openTab, `
    <!DOCTYPE html>
    <html><body>On-page agent host</body></html>
  `);
  await page.waitForLoadState('domcontentloaded');

  const action = { type: 'INVIA_FEEDBACK', testo: 'Segnalazione dall\'agente on-page', titolo: 'Test on-page' };

  // 1) CONFIRM a FREDDO (nessun RUN precedente) da origine esterna → rifiutato,
  //    nessun feedback inviato.
  const cold = await page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_CONFIRM_ACTION, action: a }), action);
  expect(cold.executed).toBe(false);
  expect(await app.evaluate(() => globalThis.__fbCalls.length)).toBe(0);

  // 2) RUN legittimo: livello 2 → il main non esegue, chiede conferma.
  const run = await page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_RUN_ACTION, action: a }), action);
  expect(run.executed).toBe(false);
  expect(run.needsConfirm).toBe(2);
  expect(await app.evaluate(() => globalThis.__fbCalls.length)).toBe(0);

  // 3) CONFIRM dopo il RUN → esegue davvero (il feedback parte).
  const ok = await page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_CONFIRM_ACTION, action: a }), action);
  expect(ok.executed).toBe(true);
  await expect.poll(() => app.evaluate(() => globalThis.__fbCalls.length)).toBe(1);

  // 4) La conferma è ONE-TIME: un secondo CONFIRM senza un nuovo RUN è rifiutato.
  const replay = await page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_CONFIRM_ACTION, action: a }), action);
  expect(replay.executed).toBe(false);
  expect(await app.evaluate(() => globalThis.__fbCalls.length)).toBe(1);

  await app.evaluate(() => { globalThis.SN_FEEDBACK.submit = globalThis.__origFbSubmit; });
});
