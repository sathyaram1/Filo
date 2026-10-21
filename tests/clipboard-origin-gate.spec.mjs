// Confine d'origine dei canali cronologia appunti / cronologia AI / costi
// (feedback #246, aggiornato dal #256 e dal #589.4).
//
// I canali DAVVERO riservati che nessun content script di pagina web usa
// (cronologia AI, costi) restano ammessi solo da origine filo://. Le scritture
// della cronologia appunti passano anche da origine web, perché il menu "Incolla"
// gira su qualunque pagina (#256), ma solo dopo un gesto dell'utente sulla scheda
// in vista e senza rispondere con l'elenco; descrivere un'immagine resta aperto.
// La regola: services/appuntiDaiSiti.js; l'elenco a un sito: tests/appunti-dai-siti.spec.mjs.

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
    // Il gesto dell'utente sulla scheda lo segna il main (services/permessiPagine.js).
    // Una finestra che si vede: le scritture da un sito passano solo dalla scheda in vista.
    const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false };
    S = { ...S, web: { ...S.web, win, wc: { _filoGestoAlle: Date.now() } } };

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
      afterRemove: await send(MSG.GET_CLIPBOARD_HISTORY, S.filo),
      // Cronologia appunti: svuotamento da origine web.
      webClearClip: await send(MSG.CLEAR_CLIPBOARD_HISTORY, S.web),
      afterClear: await send(MSG.GET_CLIPBOARD_HISTORY, S.filo),
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

test('#246/#589.4 da un\'origine web le scritture della cronologia appunti passano dopo un gesto, senza riportare l\'elenco', async ({ app, shell }) => {
  void shell;
  const SENTINEL = 'CLIP_246_' + Date.now();
  const out = await app.evaluate(async (_electron, arg) => {
    const MSG = globalThis.SN_MSG.MSG;
    const { filo } = arg.senders;
    const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false };
    const web = { ...arg.senders.web, win, wc: { _filoGestoAlle: Date.now() } };
    const send = (type, sender, extra = {}) =>
      globalThis.SN_HANDLE_MESSAGE({ type, ...extra }, sender);

    // Copia/incolla su un sito: la voce entra in cronologia.
    const pushed = await send(MSG.PUSH_CLIPBOARD_ENTRY, web, { entry: { type: 'text', text: arg.sentinel } });
    const dataUrl = 'data:image/png;base64,AAAA';
    await send(MSG.PUSH_CLIPBOARD_ENTRY, web, { entry: { type: 'image', dataUrl } });
    const removed = await send(MSG.REMOVE_CLIPBOARD_ENTRY, web, { entry: { type: 'text', text: 'non-c-e' } });
    // La descrizione arriva da un modello anche molto dopo il gesto.
    const updated = await send(MSG.UPDATE_CLIPBOARD_DESCRIPTION, arg.senders.web, { dataUrl, description: 'descr web' });
    // Un mittente web senza il menu aperto non legge l'elenco.
    const webGet = await send(MSG.GET_CLIPBOARD_HISTORY, web);
    const after = await send(MSG.GET_CLIPBOARD_HISTORY, filo);
    return { pushed, updated, removed, webGet, after };
  }, { sentinel: SENTINEL, senders: SENDERS });

  for (const r of [out.pushed, out.updated, out.removed]) {
    expect(r).toEqual({ ok: true });
  }
  expect(out.webGet).toEqual({ ok: false, code: 'forbidden', error: 'forbidden' });
  // Le scritture da web sono persistite.
  expect(out.after.ok).toBe(true);
  expect(out.after.items.some((i) => i.type === 'text' && i.text === SENTINEL)).toBe(true);
  expect(out.after.items.some((i) => i.type === 'image' && i.description === 'descr web')).toBe(true);
});

test('#589.4 senza un gesto dell\'utente, o con un gesto di più di un minuto fa, un sito non aggiunge, non toglie e non svuota', async ({ app, shell }) => {
  void shell;
  const out = await app.evaluate(async (_electron, S) => {
    const MSG = globalThis.SN_MSG.MSG;
    const send = (type, sender, extra = {}) => globalThis.SN_HANDLE_MESSAGE({ type, ...extra }, sender);
    await send(MSG.CLEAR_CLIPBOARD_HISTORY, S.filo);
    await send(MSG.PUSH_CLIPBOARD_ENTRY, S.filo, { entry: { type: 'text', text: 'voce-utente' } });
    const vecchio = { ...S.web, wc: { _filoGestoAlle: Date.now() - 61_000 } };
    const esiti = [];
    for (const web of [S.web, vecchio]) {
      esiti.push(await send(MSG.PUSH_CLIPBOARD_ENTRY, web, { entry: { type: 'text', text: 'voce-del-sito' } }));
      esiti.push(await send(MSG.REMOVE_CLIPBOARD_ENTRY, web, { entry: { type: 'text', text: 'voce-utente' } }));
      esiti.push(await send(MSG.CLEAR_CLIPBOARD_HISTORY, web));
    }
    const after = await send(MSG.GET_CLIPBOARD_HISTORY, S.filo);
    return { esiti, testi: after.items.map((i) => i.text) };
  }, SENDERS);
  for (const r of out.esiti) expect(r).toMatchObject({ ok: false, code: 'forbidden' });
  expect(out.testi).toEqual(['voce-utente']);
});
