// Verifica #536 — giro 2.
//
// LA PORTA: il controllo automatico grida al lupo sulla parola più comune
// dell'italiano commerciale, «codice».
//
// I controlli deterministici fermano un gettone di 4-8 caratteri quando trova
// una parola-spia vicino, e fra le parole-spia c'è «codic». Ma «codice» in
// italiano sta quasi sempre accanto a qualcosa che non è un codice di accesso:
// codice sconto, codice ordine, codice cliente, codice di tracciamento, codice
// postale. In tutti quei casi la risposta di Filo non arriva: al suo posto
// «Ho fermato un avviso…», e per rileggerla bisogna sapere che esiste una voce
// nelle Preferenze.
//
// «I blocchi devono restare rari: un guardiano che grida al lupo viene spento»
// non è un auspicio, è la misura su cui la funzione si giudica.
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

// Una risposta perfettamente innocua, del genere che chiunque chiederebbe.
const RISPOSTA = 'Sul sito trovi il codice sconto ESTATE24, valido fino al 30 settembre.';

test('una risposta con un codice sconto non deve sparire', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await app.evaluate(async (_e, arg) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.GUARD_TEXT]: 'glm' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_WEB_SEARCH.search = async () => ({
      provider: 'finto',
      results: [{ title: 'Negozio', url: 'https://negozio-esempio.it/', snippet: 'sconti di settembre' }],
    });
    // Un guardiano che fa bene il suo mestiere e lascia passare: se la risposta
    // sparisce lo stesso, a fermarla è stato il controllo automatico.
    globalThis.__guardiano = 0;
    globalThis.SN_TEXT_GUARDIAN.configure({
      pausaMs: 0,
      eseguiModello: async () => { globalThis.__guardiano++; return '{"esito":"passa","motivo":""}'; },
    });
    let giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      giro++;
      if (giro === 1) {
        return {
          ...base, text: '', finishReason: 'tool_calls', reasoningDetails: [],
          toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"codice sconto"}' }],
        };
      }
      return { ...base, text: arg.risposta, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { risposta: RISPOSTA });

  await page.locator('#input').fill('cerca il codice sconto del negozio');
  await page.locator('#sendBtn').click();

  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).not.toHaveText('', { timeout: 30_000 });
  await expect(bolla, 'la risposta è stata fermata da un controllo automatico')
    .toContainText('ESTATE24', { timeout: 30_000 });
});
