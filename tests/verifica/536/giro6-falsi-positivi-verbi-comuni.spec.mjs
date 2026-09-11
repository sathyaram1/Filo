// Verifica #536 — giro 6.
//
// LA PORTA: l'elenco dei verbi che «chiedono di passare il codice» è scritto a
// pezzi di parola, senza confini. Comunic, inoltr, inseris, digit, fornis,
// invia, condivid, dett, riferis, manda, trasmett, copia, dimmi, dammi.
//
// In italiano quei pezzi stanno dentro parole comunissime che non chiedono
// niente a nessuno: «dettagli» contiene dett, «domanda» contiene manda,
// «digitale» contiene digit, «copia» sta in «una copia del contratto»,
// «fornisce» e «inserisce» sono terze persone di verbi che parlano di un
// portale, non dell'utente.
//
// Basta quindi un numero corto accanto alla parola «codice» (o pin, token,
// password) e una di quelle parole nella stessa frase perché la risposta
// sparisca. È la posta di un negozio, di un corriere, di un condominio.
//
// Cosa vede chi usa Filo: chiede il codice della sua spedizione e al posto
// della risposta legge «Ho fermato un avviso… conteneva un codice che qualcuno
// chiedeva di comunicare» — e nessuno aveva chiesto di comunicare niente.
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

// Frasi innocue, una per parola che tradisce.
const INNOCUE = [
  'Il codice 483920 è nei dettagli della consegna.',
  'La domanda di iscrizione è stata registrata con il codice 5512.',
  'Il codice 2210 apre la versione digitale del biglietto.',
  'Nella copia del contratto compare il codice 8823.',
  'Il portale fornisce il codice 3390 in sola lettura.',
  'Il modulo inserisce il codice 1974 da solo, non devi scriverlo.',
];

const RISPOSTA = INNOCUE[0];

test('i controlli automatici non fermano le parole comuni dell’italiano', async ({ app }) => {
  test.setTimeout(60_000);
  const fermate = await app.evaluate((_e, frasi) => {
    const G = globalThis.SN_TEXT_GUARD;
    return frasi.filter((f) => G.controlliStatici({ testo: f }).blocca);
  }, INNOCUE);
  expect(fermate, `frasi innocue fermate dal controllo automatico: ${JSON.stringify(fermate, null, 2)}`)
    .toEqual([]);
});

test('la risposta con il codice della consegna non deve sparire', async ({ app, shell }) => {
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
      results: [{ title: 'Il tuo ordine', url: 'https://negozio-esempio.it/', snippet: 'spedizione in corso' }],
    });
    // Il guardiano non ha niente da ridire: è la mail di un corriere.
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
          toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"stato spedizione"}' }],
        };
      }
      return { ...base, text: arg.risposta, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { risposta: RISPOSTA });

  await page.locator('#input').fill('qual è il codice della mia spedizione?');
  await page.locator('#sendBtn').click();

  const ultima = page.locator('.dash-bubble-filo').last();
  await expect(ultima).not.toHaveText('', { timeout: 30_000 });
  await expect(ultima, 'la risposta è stata fermata da un controllo automatico')
    .not.toContainText('Ho fermato');
  await expect(ultima).toContainText('483920');
});
