// Verifica #583, giro 1 — il canale con cui una pagina chiede i feedback al
// main non deve essere raggiungibile da un sito visitato.
//
// Chiudendo la lettura su Firestore si è aperta una porta nuova: le pagine di
// Filo chiedono al main di leggere i feedback CON le credenziali dell'owner. Su
// una macchina dove l'owner è dentro, quella porta vale l'intera posta dei
// feedback. Se un sito qualunque potesse bussarci, la chiusura sarebbe stata
// uno spostamento del problema, non una soluzione.
//
// Senza il gate d'origine questo spec è rosso: da `https://evil.example` la
// chiamata tornerebbe qualcosa di diverso da un rifiuto.

import { test, expect } from './../../fixtures/electron.mjs';

const MITTENTI = {
  web: { url: 'https://evil.example/pagina' },
  webConTab: { tab: { id: 1, url: 'https://evil.example/pagina' }, url: 'https://evil.example/pagina' },
  filo: { url: 'filo://manage/manage.html' },
};

test('feedback_fetch: da un sito visitato è rifiutato; da una pagina di Filo chiede le credenziali', async ({ app, shell }) => {
  void shell; // attende il boot: SN_HANDLE_MESSAGE dev'essere montato
  const out = await app.evaluate(async (_electron, S) => {
    const MSG = globalThis.SN_MSG.MSG;
    const send = (sender, extra = {}) =>
      globalThis.SN_HANDLE_MESSAGE({ type: MSG.FEEDBACK_FETCH, op: 'list', ...extra }, sender);
    return {
      web: await send(S.web),
      webConTab: await send(S.webConTab),
      webGetMany: await send(S.web, { op: 'getMany', ids: ['fb-uno', 'fb-due'] }),
      filo: await send(S.filo),
    };
  }, MITTENTI);

  // Un sito visitato non ottiene niente, e non gli si dice nemmeno se su questa
  // macchina c'è un owner: la risposta è la stessa in ogni caso.
  for (const r of [out.web, out.webConTab, out.webGetMany]) {
    expect(r).toBeTruthy();
    expect(r.ok).toBe(false);
    expect(r.rows).toBeUndefined();
    expect(String(r.code || '')).toBe('forbidden');
  }

  // Da una pagina di Filo la porta esiste, ma senza un admin dietro non legge
  // niente: il rifiuto è un PERMESSO che manca, non un guasto di rete.
  expect(out.filo.ok).toBe(false);
  expect(out.filo.rows).toBeUndefined();
  expect(String(out.filo.code || '')).toBe('not_admin');
});

test('anche il triage resta chiuso a un sito visitato', async ({ app, shell }) => {
  void shell;
  const out = await app.evaluate(async (_electron, S) => {
    const MSG = globalThis.SN_MSG.MSG;
    return {
      web: await globalThis.SN_HANDLE_MESSAGE(
        { type: MSG.FEEDBACK_UPDATE, id: 'fb-uno', status: 'done' }, S.web),
    };
  }, MITTENTI);
  expect(out.web.ok).toBe(false);
});
