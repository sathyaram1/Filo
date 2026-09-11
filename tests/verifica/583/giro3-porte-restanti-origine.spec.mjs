// Verifica #583, giro 3 — le porte del corridoio che non avevano il controllo
// di provenienza.
//
// Il giro 1 ha dato quel controllo alla porta che LEGGE i feedback; il giro 2
// l'ha esteso alle quattro che li scrivono. Restavano, nello stesso canale e
// nello stesso file, cinque porte con potere di proprietario senza nessun
// controllo: cambiare i modelli predefiniti (che valgono per tutte le
// installazioni di Filo), accendere e spegnere l'automazione, i bilanci dei
// giri, i modelli dei giudici, i registri del lavoro e delle routine. Quelle
// chiedevano soltanto «sei l'amministratore?», e sul computer di chi gestisce
// Filo la risposta è sempre sì.
//
// Quando ho scritto questa prova, al giro 3, fotografava l'asimmetria: quattro
// porte chiuse e cinque aperte. La correzione dello stesso giro le ha chiuse
// tutte, e la prova adesso lo verifica. La guardia permanente, quella che la
// suite rilancia per sempre, è in `tests/feedback-canali-origine.spec.mjs`.

import { test, expect } from './../../fixtures/electron.mjs';

const SITO = { url: 'https://evil.example/pagina' };

test('nessuna porta del proprietario risponde a un sito visitato', async ({ app, shell }) => {
  void shell; // attende il boot: SN_HANDLE_MESSAGE dev'essere montato

  const out = await app.evaluate(async (_electron, S) => {
    const MSG = globalThis.SN_MSG.MSG;
    const bussa = (m) => globalThis.SN_HANDLE_MESSAGE(m, S);
    return {
      // Chiuse ai giri 1 e 2.
      lettura: await bussa({ type: MSG.FEEDBACK_FETCH, op: 'list' }),
      triage: await bussa({ type: MSG.FEEDBACK_UPDATE, id: 'fb-uno', status: 'archived' }),
      decifraTesto: await bussa({ type: MSG.FEEDBACK_DECRYPT_FIELDS, fields: { text: 'FENC...' } }),
      rivaluta: await bussa({ type: MSG.FEEDBACK_REEVALUATE, feedbackIds: ['fb-uno'] }),
      // Chiuse al giro 3.
      modelliPredefiniti: await bussa({ type: MSG.DEFAULTS_UPDATE, config: { models: {} } }),
      modelliPredefinitiLettura: await bussa({ type: MSG.DEFAULTS_GET }),
      automazione: await bussa({ type: MSG.AUTOMATION_SET, enabled: true }),
      bilanci: await bussa({ type: MSG.AUTOMATION_CAPS_SET, cap2: 99 }),
      modelliGiudici: await bussa({ type: MSG.SUPPORT_MODELS_UPDATE, models: {} }),
      registroWorker: await bussa({ type: MSG.WORKER_LOG_GET }),
      registroRoutine: await bussa({ type: MSG.ROUTINE_LOG_GET, limit: 5 }),
    };
  }, SITO);

  for (const [porta, r] of Object.entries(out)) {
    expect(r, `nessuna risposta da ${porta}`).toBeTruthy();
    expect(r.ok, `${porta}: un sito visitato non deve ottenere niente`).toBe(false);
    expect(
      String(r.code || ''),
      `${porta}: il rifiuto deve arrivare per PROVENIENZA, non perché qui manca un amministratore`,
    ).toBe('forbidden');
  }
});
