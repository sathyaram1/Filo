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

const SENDERS = {
  web: { url: 'https://evil.example/page' },
  filo: { url: 'filo://options/options.html' },
};

test('#246 i canali riservati sono negati da origine web e ammessi da filo://', async ({ app, shell }) => {
  void shell; // attende il boot: SN_HANDLE_MESSAGE dev'essere già montato
  const out = await app.evaluate(async (_electron, S) => {
    const MSG = globalThis.SN_MSG.MSG;
    const send = (type, sender, extra = {}) =>
      globalThis.SN_HANDLE_MESSAGE({ type, ...extra }, sender);

    return {
      // Da origine web: ogni canale riservato deve rispondere forbidden.
      webClearClip: await send(MSG.CLEAR_CLIPBOARD_HISTORY, S.web),
      webGetHist: await send(MSG.GET_HISTORY, S.web),
      webAppendHist: await send(MSG.APPEND_HISTORY, S.web, {
        entry: { action: 'explain', input: { selection: 'x' }, output: 'y', model: 'm' },
      }),
      webClearHist: await send(MSG.CLEAR_HISTORY, S.web),
      webCosts: await send(MSG.GET_COSTS, S.web),
      // Da origine filo://: gli stessi canali devono funzionare (ok: true).
      filoGetHist: await send(MSG.GET_HISTORY, S.filo),
      filoCosts: await send(MSG.GET_COSTS, S.filo),
      filoClearClip: await send(MSG.CLEAR_CLIPBOARD_HISTORY, S.filo),
      filoClearHist: await send(MSG.CLEAR_HISTORY, S.filo),
    };
  }, SENDERS);

  // Difesa: negato da origine web.
  expect(out.webClearClip).toEqual({ ok: false, error: 'forbidden' });
  expect(out.webGetHist).toEqual({ ok: false, error: 'forbidden' });
  expect(out.webAppendHist).toEqual({ ok: false, error: 'forbidden' });
  expect(out.webClearHist).toEqual({ ok: false, error: 'forbidden' });
  expect(out.webCosts).toEqual({ ok: false, error: 'forbidden' });

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
