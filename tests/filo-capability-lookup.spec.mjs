// F2 — l'agente di Filo conosce il manifesto delle capacità e lo consulta
// on-demand per rispondere con verità a "puoi fare X?".
//
// Contratto (asserisce il SUCCESSO della feature, non l'assenza di un errore):
//   • quando Filo emette CAPACITA_DETTAGLIO per un id, la chat lo richiama DA
//     SOLA (auto-continue) col DETTAGLIO REALE di quella capacità nel contesto —
//     non con un testo generico — così la risposta finale è basata sui dati veri;
//   • il dettaglio re-immesso contiene la descrizione e il "come si attiva" della
//     capacità giusta presi dal manifesto (src/shared/capabilities.js);
//   • la risposta finale compare senza che l'utente riscriva nulla.
//
// Pre-condizione che senza il fix fallirebbe: prima dell'F2 l'agente non aveva
// né l'indice delle capacità nel prompt né un modo per ottenere il dettaglio →
// il secondo turno NON avrebbe mai ricevuto il testo del manifesto.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Stub del provider che serve una SEQUENZA di risposte e CATTURA i messaggi
// ricevuti a ogni turno (per provare cosa è rientrato nel contesto). Mirror di
// filo-command-sequence.spec.mjs.
async function stubSequence(app, turns) {
  await app.evaluate(async (_electron, { turns }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__filoTurnCount = 0;
    globalThis.__filoTurns = turns;
    globalThis.__filoMsgsByTurn = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (opts) => {
      const { attempts } = opts;
      const seq = globalThis.__filoTurns;
      const n = globalThis.__filoTurnCount;
      globalThis.__filoTurnCount += 1;
      // Cattura il prompt+conversazione di QUESTO turno per le asserzioni.
      globalThis.__filoMsgsByTurn[n] = JSON.stringify(opts.messages || []);
      const payload = seq[Math.min(n, seq.length - 1)];
      return {
        text: JSON.stringify(payload),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
    // Path non-streaming (agenti in background: lezioni/compattatore/dashboard):
    // risposta innocua, non conta nei turni di chat (che usano lo stream).
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
  }, { turns });
}

const turnCount = (app) => app.evaluate(() => globalThis.__filoTurnCount);
// Verifica che il prompt+conversazione del turno `n` contenga TUTTE le sottostringhe
// date. Fa il match DENTRO il main process per non trasferire il prompt intero
// (grande) attraverso evaluate.
const turnContains = (app, n, needles) =>
  app.evaluate((_electron, { i, needles }) => {
    const s = (globalThis.__filoMsgsByTurn || [])[i] || '';
    return needles.map((x) => s.includes(x));
  }, { i: n, needles });

test('Filo consulta il manifesto e risponde col dettaglio reale della capacità', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);

  // Turno 1: Filo chiede il dettaglio della capacità "salva per dopo".
  // Turno 2 (auto-continue): risponde all'utente — sentinella per provare che è
  // stato richiamato da solo.
  await stubSequence(app, [
    { text: '', actions: [{ type: 'CAPACITA_DETTAGLIO', ids: ['save-for-later'] }] },
    { text: 'RISPOSTA_FINALE: sì, posso mettere da parte una pagina per dopo.', actions: [] },
  ]);

  await page.locator('#input').fill('puoi salvare una pagina per dopo?');
  await page.locator('#sendBtn').click();

  // SUCCESSO: la risposta del SECONDO turno compare senza che l'utente riscriva →
  // l'auto-continue ha richiamato Filo dopo il lookup di capacità.
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_FINALE' }))
    .toBeVisible({ timeout: 15_000 });

  // Il modello è stato interrogato DUE volte in un solo invio (lookup + risposta).
  expect(await turnCount(app)).toBe(2);
  // E l'utente ha inviato un solo messaggio.
  await expect(page.locator('.dash-bubble-user')).toHaveCount(1);

  // La traccia di trasparenza del lookup è comparsa (#376: traccia scritta, non
  // più un bottone).
  await expect(page.locator('.dash-action-step', { hasText: 'Verifico cosa so fare' }))
    .toHaveCount(1); // #521: vive nella cronologia del blocco di attività, chiusa di default

  // PROVA CHIAVE: al secondo turno il contesto contiene il DETTAGLIO VERO della
  // capacità (descrizione + "come si attiva"), preso dal manifesto — non un testo
  // generico. È questo che permette a Filo di rispondere con verità.
  const [hasDesc, hasComeSi, hasInvoke] = await turnContains(app, 1, [
    'Mette da parte la pagina corrente', // desc di save-for-later
    'Come si attiva',
    'Alt+S', // invoke reale della capacità
  ]);
  expect(hasDesc).toBe(true);
  expect(hasComeSi).toBe(true);
  expect(hasInvoke).toBe(true);
});

test('l\'indice compatto delle capacità è sempre nel prompt (primo turno)', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await stubSequence(app, [
    { text: 'ok', actions: [] },
  ]);
  await page.locator('#input').fill('ciao');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'ok' })).toBeVisible({ timeout: 15_000 });

  // Già al PRIMO turno (nessuna azione richiesta) l'agente ha l'indice delle
  // capacità nel system prompt: sa SE Filo fa una cosa senza round-trip.
  const [hasSection, hasSave, hasTranslate] = await turnContains(app, 0, [
    'COSA SA FARE FILO', '[save-for-later]', '[translate-page]',
  ]);
  expect(hasSection).toBe(true);
  expect(hasSave).toBe(true);
  expect(hasTranslate).toBe(true);
});
