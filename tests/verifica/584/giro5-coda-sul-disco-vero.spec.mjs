// Verifica #584, giro 5 — la coda che stacca l'orologio, dentro Filo vero.
//
// La difesa che impedisce di ricucire i percorsi della stessa persona non sta
// nelle regole: sta in una coda sul disco che trattiene il percorso per ore.
// I giri passati l'hanno provata col deposito finto degli unit test. Qui la si
// prova nel processo principale di Filo, col deposito vero: se `setRaw` non
// esistesse o la chiave fosse sbagliata, il salvataggio fallirebbe in silenzio
// (è avvolto in un try/catch che scrive solo nei log) e la coda sparirebbe a
// ogni chiusura — cioè la sessione di aiuto verrebbe persa, oppure, se qualcuno
// un giorno togliesse la coda per rimediare, spedita nell'istante in cui è
// stata fatta.

import { test, expect } from '../../fixtures/electron.mjs';

test('un percorso finisce nella coda vera, sul disco vero, e non parte subito', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset();
    C._setAuto(false);           // niente partenze automatiche durante la prova
    C._setSorteggio(() => 0.5);

    // Se qualcosa provasse a spedire adesso, lo sapremmo.
    const submitVero = P.submit;
    let spedizioni = 0;
    P.submit = async (...a) => { spedizioni += 1; return submitVero(...a); };

    const r = await C.collectAndSave({
      session: {
        rawUrl: 'https://negozio.example/u/mario.rossi/ordini/847362',
        rawSteps: [{ selector: '[aria-label="Ordini"]', action: 'click' }],
        rawUserMessages: ['dove sono i miei ordini?'],
        success: true,
      },
      invokeAI: async ({ action }) => (
        action === 'help_intent_guess'
          ? { text: 'trovare gli ordini passati' }
          : { text: '{"ok": true}' }
      ),
    });

    const inCoda = C._peek();
    const suDisco = await globalThis.SN_STORAGE.getRaw(
      globalThis.SN_CONST.STORAGE_KEYS.PATHS_OUTBOX, null,
    );
    P.submit = submitVero;
    return {
      r, spedizioni, inCoda,
      suDisco: Array.isArray(suDisco) ? suDisco : null,
      ora: Date.now(),
    };
  });

  // è stato accettato, ma NON è partito
  expect(esito.r.saved).toBe(true);
  expect(esito.r.queued).toBe(true);
  expect(esito.spedizioni).toBe(0);
  expect(esito.inCoda.length).toBe(1);

  // il deposito vero l'ha davvero scritto: se `setRaw` fallisse, qui ci sarebbe
  // null e nessuno se ne accorgerebbe
  expect(esito.suDisco).not.toBeNull();
  expect(esito.suDisco.length).toBe(1);

  // e uscirà non prima di mezz'ora
  const voce = esito.suDisco[0];
  expect(voce.nonPrimaDi - esito.ora).toBeGreaterThan(29 * 60 * 1000);

  // quello che aspetta sul disco è già ripulito: nemmeno lì c'è il nome
  expect(voce.initialUrl).not.toContain('mario.rossi');
  expect(voce.initialUrl).not.toContain('847362');
  expect(JSON.stringify(voce).toLowerCase()).not.toContain('clientid');
});

test('la coda torna dal disco al riavvio del modulo, invece di ripartire vuota', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    // simula la riapertura di Filo: il modulo dimentica tutto e rilegge
    C._reset();
    C._setAuto(false);
    await C.flush({ now: 0 });   // costringe la lettura dal disco
    return { inCoda: C._peek().length };
  });
  expect(esito.inCoda).toBe(1);
});
