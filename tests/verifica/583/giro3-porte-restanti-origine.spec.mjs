// Verifica #583, giro 3 — le porte del corridoio che NON hanno il controllo di
// provenienza.
//
// Il giro prima aveva trovato che il controllo «da dove arriva questa
// richiesta?» stava solo sulla porta che LEGGE i feedback. La correzione l'ha
// messo anche sulle quattro porte dei feedback che scrivono (triage, frase
// pubblica, decifratura del testo, decifratura di un allegato): quelle adesso
// rifiutano per provenienza, e `giro2-canale-triage-origine.spec.mjs` lo tiene
// fermo.
//
// Restano, nello stesso identico canale e nello stesso file, altre porte con
// potere di proprietario: cambiare i modelli predefiniti di TUTTE le
// installazioni, accendere e spegnere l'automazione, cambiare i modelli dei
// giudici, leggere i registri del lavoro e delle routine. Quelle chiedono solo
// «sei l'amministratore?». Sul computer di chiunque altro la risposta è no e
// non succede niente; su quello di chi i feedback li gestisce è sempre sì.
//
// Questa prova NON è un fallimento del lavoro di #583 (quelle porte erano così
// anche prima): è la fotografia dell'asimmetria, così chi la chiuderà sa
// esattamente quali sono. Oggi è VERDE e descrive lo stato attuale; diventerà
// il posto dove girare l'asserzione quando le porte verranno chiuse.

import { test, expect } from './../../fixtures/electron.mjs';

const SITO = { url: 'https://evil.example/pagina' };

test('le porte dei feedback rifiutano per provenienza; le altre del proprietario no', async ({ app, shell }) => {
  void shell; // attende il boot: SN_HANDLE_MESSAGE dev'essere montato

  const out = await app.evaluate(async (_electron, S) => {
    const MSG = globalThis.SN_MSG.MSG;
    const bussa = (m) => globalThis.SN_HANDLE_MESSAGE(m, S);
    return {
      // Chiuse dal giro 2 — restano chiuse.
      chiuse: {
        lettura: await bussa({ type: MSG.FEEDBACK_FETCH, op: 'list' }),
        triage: await bussa({ type: MSG.FEEDBACK_UPDATE, id: 'fb-uno', status: 'archived' }),
        decifraTesto: await bussa({ type: MSG.FEEDBACK_DECRYPT_FIELDS, fields: { text: 'FENC...' } }),
        rivaluta: await bussa({ type: MSG.FEEDBACK_REEVALUATE, feedbackIds: ['fb-uno'] }),
      },
      // Stesso canale, stesso file, stesso potere: nessun controllo di provenienza.
      aperte: {
        modelliPredefiniti: await bussa({ type: MSG.DEFAULTS_UPDATE, config: { models: {} } }),
        automazione: await bussa({ type: MSG.AUTOMATION_SET, enabled: true }),
        modelliGiudici: await bussa({ type: MSG.SUPPORT_MODELS_UPDATE, models: {} }),
        registroRoutine: await bussa({ type: MSG.ROUTINE_LOG_GET, limit: 5 }),
      },
    };
  }, SITO);

  for (const [porta, r] of Object.entries(out.chiuse)) {
    expect(r, `nessuna risposta da ${porta}`).toBeTruthy();
    expect(r.ok, `${porta}: un sito visitato non deve ottenere niente`).toBe(false);
    expect(String(r.code || ''), `${porta}: il rifiuto deve arrivare per PROVENIENZA`).toBe('forbidden');
  }

  // Le altre non guardano da dove arriva la richiesta: si fermano soltanto
  // perché su questa macchina non c'è un amministratore. Sul computer di chi i
  // feedback li gestisce quel freno non c'è.
  for (const [porta, r] of Object.entries(out.aperte)) {
    expect(r, `nessuna risposta da ${porta}`).toBeTruthy();
    expect(r.ok, `${porta}: qui non c'è un amministratore, quindi comunque non passa`).toBe(false);
    expect(
      String(r.code || ''),
      `${porta}: se questa riga diventa 'forbidden' la porta è stata chiusa — aggiornare la prova e toglierla da quelle aperte.`,
    ).not.toBe('forbidden');
  }
});
