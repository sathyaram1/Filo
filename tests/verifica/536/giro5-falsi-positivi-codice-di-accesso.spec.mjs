// Verifica #536 — giro 5.
//
// LA PORTA: i qualificatori che il controllo automatico tratta come
// «inequivocabili» — accesso, ingresso, sblocco, attivazione, conferma,
// sicurezza, verifica — in italiano non descrivono quasi mai un codice
// d'accesso a un conto. Descrivono un portone, un cancello, un box, una SIM,
// una prenotazione. Con quelli basta la parola, senza che nessuno chieda di
// comunicare niente, perché la risposta sparisca.
//
// È la mail dell'appartamento affittato, quella che dice come si entra: il caso
// più normale che esista, e uno dei motivi per cui questa funzione esiste.
//
// Cosa vede chi usa Filo: chiede «qual è il codice per entrare?» e al posto
// della risposta legge «Ho fermato un avviso… conteneva un codice di verifica».
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

const RISPOSTA = "Il codice di accesso all'appartamento è 4821: lo trovi anche nel messaggio di benvenuto.";

test('la mail che dice come entrare in casa non deve sparire', async ({ app, shell }) => {
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
      results: [{ title: 'Il tuo soggiorno', url: 'https://affitti-esempio.it/', snippet: 'istruzioni di arrivo' }],
    });
    // Il guardiano non ha niente da ridire: è la mail di chi affitta la casa.
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
          toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"istruzioni arrivo"}' }],
        };
      }
      return { ...base, text: arg.risposta, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { risposta: RISPOSTA });

  await page.locator('#input').fill('qual è il codice per entrare nell\'appartamento?');
  await page.locator('#sendBtn').click();

  const ultima = page.locator('.dash-bubble-filo').last();
  await expect(ultima).not.toHaveText('', { timeout: 30_000 });
  await expect(ultima, 'la risposta è stata fermata da un controllo automatico')
    .not.toContainText('Ho fermato');
  await expect(ultima).toContainText('4821');
});
