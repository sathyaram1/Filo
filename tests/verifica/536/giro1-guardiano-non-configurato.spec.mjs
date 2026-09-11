// Verifica #536 — giro 1.
//
// LA PORTA: un errore di configurazione si presenta come un guasto di rete.
//
// Il guardiano rifiuta — giustamente — di girare sullo stesso modello che ha
// scritto il testo, e rifiuta di partire se non ne ha uno. Il messaggio che
// spiega tutto viene scritto («è impostato sullo stesso modello che scrive i
// testi: serve un modello diverso») e poi buttato: all'utente arriva solo «il
// controllo di sicurezza non risponde», la stessa frase di quando è caduta la
// rete.
//
// Differenza pratica: se è la rete, aspettare basta. Se è la configurazione,
// aspettare non serve a niente — ogni risposta nata da una ricerca sparirà in
// coda per sempre — e l'unica persona che può rimettere a posto la cosa non ha
// modo di sapere che c'è qualcosa da rimettere a posto.
//
// Rosso finché la porta è aperta.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('col guardiano impostato sullo stesso modello della chat, l’utente sa cosa c’è da sistemare', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      // Lo stesso modello per la chat e per il guardiano: il codice lo rifiuta,
      // ed è giusto che lo rifiuti. La domanda è cosa ne sa l'utente.
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.GUARD_TEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_WEB_SEARCH.search = async () => ({
      provider: 'finto',
      results: [{ title: 'Portale', url: 'https://portale-esempio.it/', snippet: 'accedi' }],
    });
    let giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      giro++;
      if (giro === 1) {
        return { ...base, text: '', finishReason: 'tool_calls', reasoningDetails: [],
          toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"portale"}' }] };
      }
      return { ...base, text: 'Ecco cosa ho trovato.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('cerca il portale clienti');
  await page.locator('#sendBtn').click();

  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText('controllo di sicurezza', { timeout: 30_000 });
  // Quello che manca: la frase deve dire che c'è un modello da sistemare, non
  // lasciar credere a un guasto passeggero.
  await expect(bolla, 'la chat non dice che il guardiano ha bisogno di un modello diverso')
    .toContainText(/modello/i);
});
