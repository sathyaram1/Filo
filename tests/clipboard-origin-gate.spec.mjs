// Confine d'origine dei canali cronologia appunti / cronologia AI / costi
// (feedback #246, aggiornato dal #256).
//
// Regola: i canali DAVVERO riservati che nessun content script di pagina web usa
// (cronologia AI, costi) restano ammessi solo da origine filo://. Invece TUTTE le
// operazioni della cronologia appunti — leggere, aggiungere, aggiornare la
// descrizione, RIMUOVERE una voce e SVUOTARE la cronologia — sono consentite anche
// da origine web, perché il menu "Incolla" con la sua cronologia gira su qualunque
// pagina e l'utente deve poterla gestire da lì (#256).
//
// Perché svuotare/rimuovere da origine web è sicuro quanto leggere: la lettura
// (GET_CLIPBOARD_HISTORY) è già consentita da origine web — è l'operazione più
// sensibile (vedere ciò che hai copiato) — e la rimozione per-voce permette
// comunque di svuotare in loop. Gating lo svuotamento non aggiungeva protezione
// reale: la barriera vera resta l'isolamento di contesto (il main world delle
// pagine ostili non vede chrome.runtime).
//
// Gli assert affermano il SUCCESSO della difesa E il SUCCESSO della feature:
// - senza il gate sui canali riservati, questi passerebbero da origine web → rosso;
// - se si (ri)mettesse il gate sui canali della cronologia appunti, gestirla da
//   origine web fallirebbe → rosso.

import { test, expect } from './fixtures/electron.mjs';

const SENDERS = {
  web: { url: 'https://evil.example/page' },
  filo: { url: 'filo://options/options.html' },
};

test('#246/#256 i canali riservati (AI/costi) sono negati da origine web; la cronologia appunti è gestibile da origine web e da filo://', async ({ app, shell }) => {
  void shell; // attende il boot: SN_HANDLE_MESSAGE dev'essere già montato
  const out = await app.evaluate(async (_electron, S) => {
    const MSG = globalThis.SN_MSG.MSG;
    const send = (type, sender, extra = {}) =>
      globalThis.SN_HANDLE_MESSAGE({ type, ...extra }, sender);

    // Semina 3 voci (da origine web, come fa il content script su copia) così
    // rimozione e svuotamento hanno qualcosa su cui agire.
    await send(MSG.PUSH_CLIPBOARD_ENTRY, S.web, { entry: { type: 'text', text: 'gate-a' } });
    await send(MSG.PUSH_CLIPBOARD_ENTRY, S.web, { entry: { type: 'text', text: 'gate-b' } });
    await send(MSG.PUSH_CLIPBOARD_ENTRY, S.web, { entry: { type: 'text', text: 'gate-c' } });

    return {
      // Canali riservati: negati da origine web.
      webGetHist: await send(MSG.GET_HISTORY, S.web),
      webAppendHist: await send(MSG.APPEND_HISTORY, S.web, {
        entry: { action: 'explain', input: { selection: 'x' }, output: 'y', model: 'm' },
      }),
      webClearHist: await send(MSG.CLEAR_HISTORY, S.web),
      webCosts: await send(MSG.GET_COSTS, S.web),
      // Cronologia appunti: rimozione singola da origine web (togli 'gate-b').
      webRemoveEntry: await send(MSG.REMOVE_CLIPBOARD_ENTRY, S.web, { entry: { type: 'text', text: 'gate-b' } }),
      afterRemove: await send(MSG.GET_CLIPBOARD_HISTORY, S.web),
      // Cronologia appunti: svuotamento da origine web.
      webClearClip: await send(MSG.CLEAR_CLIPBOARD_HISTORY, S.web),
      afterClear: await send(MSG.GET_CLIPBOARD_HISTORY, S.web),
      // Da origine filo://: i riservati funzionano.
      filoGetHist: await send(MSG.GET_HISTORY, S.filo),
      filoCosts: await send(MSG.GET_COSTS, S.filo),
      filoClearClip: await send(MSG.CLEAR_CLIPBOARD_HISTORY, S.filo),
      filoClearHist: await send(MSG.CLEAR_HISTORY, S.filo),
    };
  }, SENDERS);

  // Difesa: i canali riservati sono negati da origine web.
  expect(out.webGetHist).toEqual({ ok: false, error: 'forbidden' });
  expect(out.webAppendHist).toEqual({ ok: false, error: 'forbidden' });
  expect(out.webClearHist).toEqual({ ok: false, error: 'forbidden' });
  expect(out.webCosts).toEqual({ ok: false, error: 'forbidden' });

  // Feature #256: rimozione singola da origine web funziona e persiste.
  expect(out.webRemoveEntry.ok).toBe(true);
  expect(out.afterRemove.ok).toBe(true);
  expect(out.afterRemove.items.some((i) => i.type === 'text' && i.text === 'gate-b')).toBe(false);
  expect(out.afterRemove.items.some((i) => i.type === 'text' && i.text === 'gate-a')).toBe(true);

  // Feature #256: svuotamento da origine web funziona e azzera la cronologia.
  expect(out.webClearClip.ok).toBe(true);
  expect(out.afterClear.ok).toBe(true);
  expect(out.afterClear.items).toEqual([]);

  // Feature: da filo:// funzionano.
  expect(out.filoGetHist.ok).toBe(true);
  expect(Array.isArray(out.filoGetHist.items)).toBe(true);
  expect(out.filoCosts.ok).toBe(true);
  expect(out.filoClearClip.ok).toBe(true);
  expect(out.filoClearHist.ok).toBe(true);
});

test('#246 la cronologia appunti resta usabile da un\'origine web (menu Incolla su qualunque pagina)', async ({ app, shell }) => {
  void shell;
  const SENTINEL = 'CLIP_246_' + Date.now();
  const out = await app.evaluate(async (_electron, arg) => {
    const MSG = globalThis.SN_MSG.MSG;
    const web = arg.senders.web;
    const send = (type, extra = {}) =>
      globalThis.SN_HANDLE_MESSAGE({ type, ...extra }, web);

    // Aggiungi una voce da origine web (come fa il content script su copia/incolla).
    const pushed = await send(MSG.PUSH_CLIPBOARD_ENTRY, {
      entry: { type: 'text', text: arg.sentinel },
    });
    // Rileggi la cronologia da origine web (come fa il menu Incolla).
    const got = await send(MSG.GET_CLIPBOARD_HISTORY);
    // Aggiungi e aggiorna la descrizione di un'immagine da origine web.
    const dataUrl = 'data:image/png;base64,AAAA';
    await send(MSG.PUSH_CLIPBOARD_ENTRY, { entry: { type: 'image', dataUrl } });
    const updated = await send(MSG.UPDATE_CLIPBOARD_DESCRIPTION, {
      dataUrl, description: 'descr web',
    });
    const after = await send(MSG.GET_CLIPBOARD_HISTORY);
    return { pushed, got, updated, after };
  }, { sentinel: SENTINEL, senders: SENDERS });

  // Push da web è consentito e restituisce la lista aggiornata.
  expect(out.pushed.ok).toBe(true);
  // La lettura da web vede la voce appena inserita (feature: menu Incolla).
  expect(out.got.ok).toBe(true);
  expect(out.got.items.some((i) => i.type === 'text' && i.text === SENTINEL)).toBe(true);
  // La descrizione immagine, aggiornata da web, è persistita.
  expect(out.updated.ok).toBe(true);
  expect(out.after.items.some((i) => i.type === 'image' && i.description === 'descr web')).toBe(true);
});
