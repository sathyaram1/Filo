// #250 — Controparte legittima di audit-confirm-bypass.
//
// La difesa in profondità su FILO_CONFIRM_ACTION NON deve rompere l'agente
// on-page ("Aiuto"): sulle pagine web ESTERNE la sidebar può eseguire azioni di
// livello 2 (es. inviare un feedback agli sviluppatori) passando per il giro
// legittimo RUN → popup di conferma → CONFIRM. Solo il CONFIRM "a freddo" (senza
// il RUN che lo precede) da un'origine esterna viene rifiutato.
//
// Esercitiamo il dispatch reale nel main (SN_EXECUTE_FILO_ACTION) con mittenti
// sintetici — perché sulle pagine web esterne chrome.runtime.sendMessage NON è
// esposto al mondo principale (è proprio l'isolamento su cui poggia la barriera),
// quindi non è pilotabile via page.evaluate. Qui verifichiamo la LOGICA del gate:
//   • CONFIRM a freddo da origine esterna → rifiutato (nessuna esecuzione);
//   • RUN (livello 2) → needsConfirm, niente esecuzione, registra il pending;
//   • CONFIRM dopo il RUN dallo STESSO mittente → esegue davvero;
//   • la conferma è ONE-TIME: un secondo CONFIRM senza nuovo RUN → rifiutato.
//
// Se qualcuno "semplificasse" il gate a un semplice isFilo(origin), i passi 2-3
// diventerebbero rossi (l'agente on-page smetterebbe di funzionare sulle pagine
// web). Gli assert verificano il SUCCESSO del cammino legittimo, non l'assenza
// di un errore.

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(30_000);

const exec = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const fbCalls = (app) => app.evaluate(() => globalThis.__fbCalls.length);

test('on-page agent (origine esterna): RUN→CONFIRM esegue livello 2; il CONFIRM a freddo no', async ({ app }) => {
  // Stub del submit feedback nel main: registra le chiamate senza toccare la rete.
  await app.evaluate(() => {
    const FB = globalThis.SN_FEEDBACK;
    globalThis.__origFbSubmit = FB.submit;
    globalThis.__fbCalls = [];
    FB.submit = async (payload) => { globalThis.__fbCalls.push(payload); return { id: 'test-fb' }; };
  });

  // Mittente sintetico: una pagina web esterna (origine http://, non filo://).
  const extSender = { tab: { id: 4242, url: 'http://evil.example/' }, url: 'http://evil.example/' };
  const action = { type: 'INVIA_FEEDBACK', testo: 'Segnalazione dall\'agente on-page', titolo: 'Test on-page' };

  // 1) CONFIRM a FREDDO da origine esterna (nessun RUN prima) → rifiutato.
  const cold = await exec(app, action, { confirmed: true, sender: extSender });
  expect(cold.executed).toBe(false);
  expect(cold.rejected).toBe(true);
  expect(await fbCalls(app)).toBe(0);

  // 2) RUN legittimo: livello 2 → il main non esegue, chiede conferma.
  const run = await exec(app, action, { sender: extSender });
  expect(run.executed).toBe(false);
  expect(run.needsConfirm).toBe(2);
  expect(await fbCalls(app)).toBe(0);

  // 3) CONFIRM dopo il RUN, STESSO mittente → esegue davvero (il feedback parte).
  const ok = await exec(app, action, { confirmed: true, sender: extSender });
  expect(ok.executed).toBe(true);
  expect(await fbCalls(app)).toBe(1);

  // 4) ONE-TIME: un secondo CONFIRM senza un nuovo RUN → rifiutato.
  const replay = await exec(app, action, { confirmed: true, sender: extSender });
  expect(replay.executed).toBe(false);
  expect(await fbCalls(app)).toBe(1);

  await app.evaluate(() => { globalThis.SN_FEEDBACK.submit = globalThis.__origFbSubmit; });
});
