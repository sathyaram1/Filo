// Confine d'origine dei canali cronologia appunti / cronologia AI / costi
// (feedback #246, aggiornato dal #256 e dal #589.4).
//
// I canali DAVVERO riservati che nessun content script di pagina web usa
// (cronologia AI, costi) restano ammessi solo da origine filo://. Le scritture
// della cronologia appunti — aggiungere, aggiornare la descrizione, RIMUOVERE una
// voce e SVUOTARE — passano anche da origine web, perché il menu "Incolla" gira
// su qualunque pagina (#256), ma non rispondono con l'elenco. L'elenco lo dà solo
// la lettura, e a un sito solo dalla scheda in vista dopo un gesto (#589.4,
// tests/appunti-dai-siti.spec.mjs): qui il mittente web non ha scheda, quindi
// la lettura si rifà da filo://.

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

test('#246/#589.4 da un\'origine web le scritture della cronologia appunti passano senza riportare l\'elenco', async ({ app, shell }) => {
  void shell;
  const SENTINEL = 'CLIP_246_' + Date.now();
  const out = await app.evaluate(async (_electron, arg) => {
    const MSG = globalThis.SN_MSG.MSG;
    const { web, filo } = arg.senders;
    const send = (type, sender, extra = {}) =>
      globalThis.SN_HANDLE_MESSAGE({ type, ...extra }, sender);

    // Copia/incolla su un sito: la voce entra in cronologia.
    const pushed = await send(MSG.PUSH_CLIPBOARD_ENTRY, web, { entry: { type: 'text', text: arg.sentinel } });
    const dataUrl = 'data:image/png;base64,AAAA';
    await send(MSG.PUSH_CLIPBOARD_ENTRY, web, { entry: { type: 'image', dataUrl } });
    const updated = await send(MSG.UPDATE_CLIPBOARD_DESCRIPTION, web, { dataUrl, description: 'descr web' });
    const removed = await send(MSG.REMOVE_CLIPBOARD_ENTRY, web, { entry: { type: 'text', text: 'non-c-e' } });
    // Un mittente web senza scheda in vista non legge l'elenco.
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
