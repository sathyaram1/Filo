// Verifica #583, giro 2 — le altre porte dello stesso corridoio.
//
// Chiudendo la lettura dei feedback si è dato al canale che li legge un
// controllo di PROVENIENZA: una pagina di un sito visitato bussa e si sente
// rispondere di no, prima ancora che si guardi chi è loggato. Il corridoio però
// ha altre porte, e sono quelle che contano di più: cambiare lo stato di una
// segnalazione, scrivere la frase che finisce in bacheca sotto gli occhi di
// tutti, farsi decifrare il testo e gli allegati. Quelle chiedono solo «sei
// l'amministratore?». Sul computer dell'owner — l'unico dove la domanda ha
// risposta sì, e l'unico dove c'è qualcosa da prendere — quella non è una
// porta chiusa.
//
// La prova bussa a tutte dallo stesso sito visitato e si aspetta la stessa
// risposta: un rifiuto per provenienza.

import { test, expect } from './../../fixtures/electron.mjs';

const SITO = { url: 'https://evil.example/pagina' };

test('dal sito visitato ogni porta dei feedback rifiuta per provenienza, non solo la lettura', async ({ app, shell }) => {
  void shell; // attende il boot: SN_HANDLE_MESSAGE dev'essere montato

  const out = await app.evaluate(async (_electron, S) => {
    const MSG = globalThis.SN_MSG.MSG;
    const bussa = (m) => globalThis.SN_HANDLE_MESSAGE(m, S);
    return {
      lettura: await bussa({ type: MSG.FEEDBACK_FETCH, op: 'list' }),
      triage: await bussa({ type: MSG.FEEDBACK_UPDATE, id: 'fb-uno', status: 'archived' }),
      frasePubblica: await bussa({ type: MSG.FEEDBACK_UPDATE, id: 'fb-uno', userNote: 'testo scritto da un sito' }),
      decifraTesto: await bussa({ type: MSG.FEEDBACK_DECRYPT_FIELDS, fields: { text: 'FENC...' } }),
      decifraImmagine: await bussa({ type: MSG.FEEDBACK_DECRYPT_IMAGE, url: 'https://storage.googleapis.com/qualcosa/allegato' }),
    };
  }, SITO);

  for (const [porta, r] of Object.entries(out)) {
    expect(r, `nessuna risposta da ${porta}`).toBeTruthy();
    expect(r.ok, `${porta}: un sito visitato non deve ottenere niente`).toBe(false);
    expect(
      String(r.code || ''),
      `${porta}: il rifiuto arriva perché su questa macchina non c'è un amministratore, non perché chi bussa è un sito. Sul computer dell'owner la stessa chiamata passerebbe.`,
    ).toBe('forbidden');
  }
});
