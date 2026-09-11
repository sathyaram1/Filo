// I canali dei feedback rispondono solo alle superfici di Filo (#583).
//
// Chiudere la lettura dei feedback su Firestore ha spostato il lavoro dentro
// Filo: adesso sono le pagine di Filo a chiedere al processo principale di
// leggere, cambiare e decifrare le segnalazioni, con le credenziali di chi le
// gestisce. Su una macchina dove quella sessione è aperta, quei canali valgono
// l'intera posta dei feedback e la bacheca che tutti leggono.
//
// Chiedere solo «sei l'amministratore?» non basta: sul computer di chi gestisce
// i feedback la risposta è sempre sì, ed è l'unico dove c'è qualcosa da
// prendere. Prima si guarda DA DOVE arriva la richiesta: una pagina di un sito
// visitato non ottiene niente, e non scopre nemmeno se su quella macchina c'è
// un amministratore (la risposta è identica in ogni caso).
//
// Senza il controllo di provenienza questo spec è rosso su tutte le porte
// tranne la lettura.

import { test, expect } from './fixtures/electron.mjs';

const SITO = { url: 'https://evil.example/pagina' };
const SITO_CON_SCHEDA = { tab: { id: 1, url: 'https://evil.example/pagina' }, url: 'https://evil.example/pagina' };
const PAGINA_DI_FILO = { url: 'filo://manage/manage.html' };

test('da un sito visitato ogni canale dei feedback rifiuta per provenienza', async ({ app, shell }) => {
  void shell; // attende il boot: il dispatcher dev'essere montato

  const out = await app.evaluate(async (_electron, mittenti) => {
    const MSG = globalThis.SN_MSG.MSG;
    const porte = (mittente) => ({
      lettura: { type: MSG.FEEDBACK_FETCH, op: 'list' },
      triage: { type: MSG.FEEDBACK_UPDATE, id: 'fb-uno', status: 'archived' },
      frasePubblica: { type: MSG.FEEDBACK_UPDATE, id: 'fb-uno', userNote: 'scritta da un sito' },
      decifraTesto: { type: MSG.FEEDBACK_DECRYPT_FIELDS, fields: { text: 'FENC1:qualcosa' } },
      decifraAllegato: { type: MSG.FEEDBACK_DECRYPT_IMAGE, url: 'https://storage.googleapis.com/altro/allegato' },
      rivaluta: { type: MSG.FEEDBACK_REEVALUATE, feedbackIds: ['fb-uno'] },
      _mittente: mittente,
    });
    const esegui = async (mittente) => {
      const { _mittente, ...msgs } = porte(mittente);
      const res = {};
      for (const [nome, msg] of Object.entries(msgs)) {
        res[nome] = await globalThis.SN_HANDLE_MESSAGE(msg, _mittente);
      }
      return res;
    };
    return {
      sito: await esegui(mittenti.sito),
      sitoConScheda: await esegui(mittenti.sitoConScheda),
      filo: await esegui(mittenti.filo),
    };
  }, { sito: SITO, sitoConScheda: SITO_CON_SCHEDA, filo: PAGINA_DI_FILO });

  for (const provenienza of ['sito', 'sitoConScheda']) {
    for (const [porta, r] of Object.entries(out[provenienza])) {
      expect(r, `${provenienza}/${porta}: nessuna risposta`).toBeTruthy();
      expect(r.ok, `${provenienza}/${porta}: un sito visitato non deve ottenere niente`).toBe(false);
      expect(
        String(r.code || ''),
        `${provenienza}/${porta}: rifiutato per il motivo sbagliato — così su una macchina dove i feedback si gestiscono la richiesta passerebbe`,
      ).toBe('forbidden');
      expect(r.rows, `${provenienza}/${porta}: niente dati`).toBeUndefined();
      expect(r.list, `${provenienza}/${porta}: niente dati`).toBeUndefined();
      expect(r.fields, `${provenienza}/${porta}: niente dati`).toBeUndefined();
    }
  }

  // Da una pagina di Filo la porta esiste: senza una sessione di chi gestisce i
  // feedback non legge niente, ma il rifiuto è un PERMESSO che manca — ed è
  // così che la pagina sa di dover dire «serve l'amministratore» invece di
  // «controlla la connessione».
  for (const [porta, r] of Object.entries(out.filo)) {
    expect(r.ok, `filo/${porta}`).toBe(false);
    expect(String(r.code || ''), `filo/${porta}`).toBe('not_admin');
  }
});
