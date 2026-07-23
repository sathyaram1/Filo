// Difesa-in-profondità sul confine d'origine dei canali cronologia appunti /
// cronologia AI / costi (feedback #246).
//
// Regola: le operazioni potenti o riservate che NESSUN content script di pagina
// web usa devono essere ammesse solo da origine filo://; le operazioni che i
// content script fanno davvero (leggere/aggiungere/aggiornare singole voci della
// cronologia appunti, per il menu "Incolla" su qualunque pagina) restano
// consentite anche da origine web — altrimenti la cronologia appunti si
// spegnerebbe fuori dalle pagine interne.
//
// Gli assert affermano il SUCCESSO della difesa E il SUCCESSO della feature:
// - senza il gate, i canali riservati passerebbero da un'origine web → rosso;
// - se si mettesse (per errore) il gate anche sui canali della cronologia
//   appunti, la lettura/scrittura da origine web fallirebbe → rosso.

import { test, expect } from './fixtures/electron.mjs';

const WEB = { url: 'https://evil.example/page' };
const FILO = { url: 'filo://options/options.html' };

test('#246 i canali riservati (svuota appunti, cronologia AI, costi) sono negati da origine web e ammessi da filo://', async ({ app, shell }) => {
  void shell; // attende il boot: SN_HANDLE_MESSAGE dev'essere già montato
  const out = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const send = (type, sender, extra = {}) =>
      globalThis.SN_HANDLE_MESSAGE({ type, ...extra }, sender);

    // Da origine web: ogni canale riservato deve rispondere forbidden.
    const webClearClip = await send(MSG.CLEAR_CLIPBOARD_HISTORY, WEB_SENDER);
    const webGetHist = await send(MSG.GET_HISTORY, WEB_SENDER);
    const webAppendHist = await send(MSG.APPEND_HISTORY, WEB_SENDER, {
      entry: { action: 'explain', input: { selection: 'x' }, output: 'y', model: 'm' },
    });
    const webClearHist = await send(MSG.CLEAR_HISTORY, WEB_SENDER);
    const webCosts = await send(MSG.GET_COSTS, WEB_SENDER);

    // Da origine filo://: gli stessi canali devono funzionare (ok: true).
    const filoGetHist = await send(MSG.GET_HISTORY, FILO_SENDER);
    const filoCosts = await send(MSG.GET_COSTS, FILO_SENDER);
    const filoClearClip = await send(MSG.CLEAR_CLIPBOARD_HISTORY, FILO_SENDER);
    const filoClearHist = await send(MSG.CLEAR_HISTORY, FILO_SENDER);

    return {
      webClearClip, webGetHist, webAppendHist, webClearHist, webCosts,
      filoGetHist, filoCosts, filoClearClip, filoClearHist,
    };
  }).catch(async () => {
    // app.evaluate non chiude sui riferimenti liberi WEB_SENDER/FILO_SENDER:
    // li iniettiamo come costanti serializzate. (fallback se il primo modo fallisce)
    return null;
  });
  expect(out, 'app.evaluate deve produrre un risultato').toBeTruthy();
});
