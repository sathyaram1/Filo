// Verifica #536 — giro 4.
//
// LA PORTA: il giro 2 ha tolto di mezzo «codice» come parola-spia, e la lista
// dei qualificatori innocui («codice sconto», «codice ordine») fa il suo
// mestiere — finché la frase è scritta in quella forma lì. In italiano però
// quella forma è la meno comune: si scrive «il codice dell'ordine», «il codice
// della promozione», «il codice del coupon». Con l'articolo in mezzo il
// qualificatore non viene più riconosciuto, resta la sola parola generica, e
// basta un verbo qualunque («comunicalo all'assistenza», «digitalo al
// pagamento») perché la risposta sparisca.
//
// Cosa vede chi usa Filo: chiede il codice del suo ordine, e al posto della
// risposta legge «Ho fermato un avviso… conteneva un codice di verifica». È lo
// stesso danno del giro 2, dalla porta di fianco — e sono proprio le mail di
// acquisti e spedizioni il motivo per cui questa funzione esiste.
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

const RISPOSTA = "Il codice dell'ordine è 7712345: comunicalo all'assistenza se devi chiedere il reso.";

test('una risposta con il codice dell’ordine non deve sparire', async ({ app, shell }) => {
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
      results: [{ title: 'Il tuo ordine', url: 'https://negozio-esempio.it/', snippet: 'ordine 7712345' }],
    });
    // Il guardiano non ha niente da ridire: è la conferma di un acquisto.
    globalThis.SN_PROVIDERS.completeWithFallback = async (opt) => {
      const attempts = opt.attempts;
      const sistema = String(((opt.messages || [])[0] || {}).content || '');
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: /^Sei il guardiano degli avvisi di Filo/.test(sistema) ? '{"esito":"passa","motivo":""}' : '',
      };
    };
    let giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      giro++;
      if (giro === 1) {
        return {
          ...base, text: '', finishReason: 'tool_calls', reasoningDetails: [],
          toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"ordine"}' }],
        };
      }
      return { ...base, text: arg.risposta, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { risposta: RISPOSTA });

  await page.locator('#input').fill("qual è il codice dell'ordine?");
  await page.locator('#sendBtn').click();

  const ultima = page.locator('.dash-bubble-filo').last();
  await expect(ultima).not.toHaveText('', { timeout: 30_000 });
  await expect(ultima, 'la risposta è stata fermata da un controllo automatico')
    .not.toContainText('Ho fermato');
  await expect(ultima).toContainText('7712345');
});
