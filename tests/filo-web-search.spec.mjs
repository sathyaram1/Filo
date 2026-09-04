// #368 — quando l'utente chiede a Filo di trovare qualcosa sul web (es. "video
// di Anthropic su J Space"), Filo emette CERCA_WEB. Prima questo ramo era INERTE:
// il chip "🔎 ..." non faceva nulla, nessun risultato tornava mai e l'utente
// vedeva un "link che non funziona". Ora la ricerca viene ESEGUITA e i risultati
// reali rientrano nel contesto (auto-continue) così Filo risponde con link veri.
//
// Contratto (asserisce il SUCCESSO della feature, non l'assenza di un errore):
//   • quando Filo emette CERCA_WEB, la chat lo richiama DA SOLA (auto-continue)
//     con i RISULTATI REALI della ricerca nel contesto (titolo + URL + snippet);
//   • la risposta finale compare senza che l'utente riscriva nulla.
//
// Pre-condizione che senza il fix fallirebbe: prima, CERCA_WEB non restituiva
// output → niente auto-continue → un solo turno e nessun risultato nel contesto.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Stub del provider LLM che serve una SEQUENZA di risposte e cattura i messaggi
// di ogni turno. Stubba ANCHE la ricerca web con risultati deterministici, così
// il test non dipende dalla rete.
async function stubSequenceAndSearch(app, turns, results) {
  await app.evaluate(async (_electron, { turns, results }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.__filoTurnCount = 0;
    globalThis.__filoTurns = turns;
    globalThis.__filoMsgsByTurn = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (opts) => {
      const { attempts } = opts;
      const seq = globalThis.__filoTurns;
      const n = globalThis.__filoTurnCount;
      globalThis.__filoTurnCount += 1;
      globalThis.__filoMsgsByTurn[n] = JSON.stringify(opts.messages || []);
      const payload = seq[Math.min(n, seq.length - 1)];
      return {
        text: JSON.stringify(payload),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    // Ricerca web deterministica: niente rete nel test.
    globalThis.SN_WEB_SEARCH.search = async () => ({ ok: true, provider: 'stub', results });
  }, { turns, results });
}

const turnCount = (app) => app.evaluate(() => globalThis.__filoTurnCount);
const turnContains = (app, n, needles) =>
  app.evaluate((_electron, { i, needles }) => {
    const s = (globalThis.__filoMsgsByTurn || [])[i] || '';
    return needles.map((x) => s.includes(x));
  }, { i: n, needles });

test('Filo esegue la ricerca web e risponde con i risultati reali', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);

  const results = [
    { title: 'Anthropic Just Found J-Space', url: 'https://www.youtube.com/watch?v=9bKLsGEn5Nc', snippet: 'Un video su J Space.' },
    { title: 'A global workspace in language models', url: 'https://www.anthropic.com/research/global-workspace', snippet: 'Ricerca ufficiale.' },
  ];

  // Turno 1: Filo cerca sul web. Turno 2 (auto-continue): risponde all'utente.
  await stubSequenceAndSearch(app, [
    { text: 'Cerco il video di Anthropic su J Space.', actions: [{ type: 'CERCA_WEB', query: 'Anthropic J Space video' }] },
    { text: 'RISPOSTA_FINALE: ecco il video che cercavi.', actions: [] },
  ], results);

  await page.locator('#input').fill('video di antropic su j space');
  await page.locator('#sendBtn').click();

  // SUCCESSO: la risposta del SECONDO turno compare senza che l'utente riscriva →
  // l'auto-continue ha richiamato Filo dopo la ricerca web.
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_FINALE' }))
    .toBeVisible({ timeout: 15_000 });

  // Il modello è stato interrogato DUE volte in un solo invio (ricerca + risposta).
  expect(await turnCount(app)).toBe(2);
  await expect(page.locator('.dash-bubble-user')).toHaveCount(1);

  // La traccia di trasparenza della ricerca è comparsa (#376: è una traccia
  // scritta, non più un bottone — vedi filo-open-background-tab.spec.mjs).
  await expect(page.locator('.dash-action-step', { hasText: 'Cerco sul web' }))
    .toHaveCount(1); // #521: vive nella cronologia del blocco di attività, chiusa di default

  // PROVA CHIAVE: al secondo turno il contesto contiene i RISULTATI VERI della
  // ricerca (titolo + URL), non un chip vuoto. È questo che permette a Filo di
  // rispondere con link reali invece di inventarne uno che non funziona.
  const [hasTitle, hasUrl, hasHeader] = await turnContains(app, 1, [
    'Anthropic Just Found J-Space',
    'https://www.youtube.com/watch?v=9bKLsGEn5Nc',
    'Risultati della ricerca web',
  ]);
  expect(hasTitle).toBe(true);
  expect(hasUrl).toBe(true);
  expect(hasHeader).toBe(true);
});
