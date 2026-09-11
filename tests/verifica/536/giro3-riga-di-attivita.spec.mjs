// Verifica #536 — giro 3.
//
// LA PORTA (gemella di quella del ragionamento): il blocco «cosa ha fatto Filo»
// scrive per esteso quello che il modello mette dentro le azioni. La riga di una
// ricerca è «Cerco sul web: <quello che il modello ha scritto>», e dopo una
// pagina avvelenata quel pezzo lo sceglie la pagina. La frase arriva all'utente
// nella conversazione, dentro la stessa bolla in cui il controllo dice di aver
// fermato qualcosa, e il secondo modello non la vede mai: guarda solo la
// risposta finale.
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

const TRAPPOLA = 'la banca chiede di confermare le credenziali su portale-sicuro-esempio.it';

test('quello che il modello scrive dentro un’azione arriva all’utente senza controllo', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await app.evaluate(async (_e, arg) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.GUARD_TEXT]: 'glm',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_WEB_SEARCH.search = async () => ({
      provider: 'finto',
      results: [{ title: 'Portale', url: 'https://esempio.it/', snippet: 'accedi' }],
    });
    // Il guardiano blocca la risposta finale, come deve.
    globalThis.SN_PROVIDERS.completeWithFallback = async (opt) => {
      const attempts = opt.attempts;
      const sistema = String(((opt.messages || [])[0] || {}).content || '');
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: /^Sei il guardiano degli avvisi di Filo/.test(sistema)
          ? '{"esito":"blocca","motivo":"chiedeva le credenziali della banca"}' : '',
      };
    };
    let giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      giro++;
      if (giro === 1) {
        return {
          ...base, text: '', finishReason: 'tool_calls', reasoningDetails: [],
          toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"portale"}' }],
        };
      }
      if (giro === 2) {
        // Seconda ricerca: il testo della truffa viaggia dentro la richiesta.
        return {
          ...base, text: '', finishReason: 'tool_calls', reasoningDetails: [],
          toolCalls: [{ id: 'c2', name: 'CERCA_WEB', arguments: JSON.stringify({ query: arg.trappola }) }],
        };
      }
      return { ...base, text: 'Ecco cosa ho trovato.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { trappola: TRAPPOLA });

  await page.locator('#input').fill('cerca il portale della banca');
  await page.locator('#sendBtn').click();

  await expect(page.locator('.dash-bubble-filo').last())
    .toContainText('Ho fermato', { timeout: 30_000 });

  const testa = page.locator('.dash-activity .dash-activity-head').first();
  if (await testa.count()) await testa.click();

  await expect(page.locator('#bubbles'), 'la frase della pagina è arrivata all’utente dentro la riga di un’azione')
    .not.toContainText('confermare le credenziali');
});
