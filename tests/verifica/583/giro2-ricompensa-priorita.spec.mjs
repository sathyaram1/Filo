// Verifica #583, giro 2 — la ricompensa di chi ha segnalato.
//
// Quando un feedback viene risolto, chi l'aveva mandato apre Filo e trova un
// annuncio con dei crediti dentro. Quanti, dipende da quanto contava la
// segnalazione: 50 per una minore, fino a 300 per una importante (è l'unica
// cosa che un alpha tester riceve in cambio del suo lavoro).
//
// Chiudendo la lettura dei feedback, l'annuncio ha cambiato sorgente: prima
// leggeva i documenti veri, adesso legge le schede pubbliche. L'importanza però
// nella scheda non c'è — l'elenco dei campi pubblicabili non la prevede, e le
// regole respingono una scheda che la portasse — quindi ogni ricompensa vale
// come la fascia più bassa.
//
// La prova mette due segnalazioni risolte della stessa installazione: una che
// l'owner aveva messo in cima e una qualunque. Se le due ricompense sono
// identiche, l'importanza è andata persa per strada.
//
// NOTA per chi corregge: la prova rappresenta l'importanza con il campo
// `priority` sulla scheda, che è la strada più breve. Se la correzione sceglie
// di portare sulla scheda i crediti già calcolati (o un'altra forma), cambia il
// finto elenco qui sotto di conseguenza: quello che deve restare vero è che due
// segnalazioni di peso diverso non valgono lo stesso.

import { test, expect } from './../../fixtures/electron.mjs';

test('la ricompensa segue l\'importanza della segnalazione', async ({ app, shell }) => {
  void shell; // attende il boot: i moduli condivisi devono essere montati

  const out = await app.evaluate(async () => {
    const FB = globalThis.SN_FEEDBACK;
    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const S = globalThis.SN_STORAGE;

    // Questa installazione ha un suo identificativo: è così che l'annuncio
    // riconosce «i miei».
    const mio = 'installazione-di-prova-583';
    const veroGetRaw = S.getRaw.bind(S);
    S.getRaw = async (k, d) => (k === 'sn_feedback_client_id' ? mio : veroGetRaw(k, d));
    const mioHash = await H.hashClientId(mio);

    // La scheda NON se la inventa la prova: la costruisce lo stesso codice che
    // la pubblica davvero, a partire dal feedback vero. È l'unico modo di
    // vedere cosa arriva sul computer di chi ha segnalato.
    const V = globalThis.SN_FEEDBACK_PUBLIC_VIEW;
    const feedbackVero = (id, priority) => ({
      _id: id,
      name: `Segnalazione ${id}`,
      text: 'testo della segnalazione',
      seq: 900, subSeq: 0,
      status: 'done',
      priority,
      resolvedInVersion: '0.2.228',
      createdAt: '2026-09-01T10:00:00Z',
      resolvedAt: '2026-09-10T10:00:00Z',
      userNote: 'Sistemato: ora funziona.',
      clientIdHash: mioHash,
    });
    const schede = [
      { _id: 'fb-importante', ...V.cardFor(feedbackVero('fb-importante', 3)) },
      { _id: 'fb-minore', ...V.cardFor(feedbackVero('fb-minore', 0)) },
    ];
    const veroListPublic = FB.listPublic;
    FB.listPublic = async () => schede;
    try {
      const r = await globalThis.SN_HANDLE_MESSAGE(
        { type: globalThis.SN_MSG.MSG.GET_FEEDBACK_REWARDS },
        { url: 'filo://newtab/' },
      );
      return r;
    } finally {
      FB.listPublic = veroListPublic;
      S.getRaw = veroGetRaw;
    }
  });

  expect(out.ok).toBe(true);
  const per = Object.fromEntries((out.rewards || []).map((r) => [r.id, r.credits]));
  expect(Object.keys(per).sort()).toEqual(['fb-importante', 'fb-minore']);
  expect(
    per['fb-importante'],
    'una segnalazione che l\'owner aveva messo in cima vale come una qualunque: l\'importanza non arriva più a chi ha segnalato',
  ).toBeGreaterThan(per['fb-minore']);
});
