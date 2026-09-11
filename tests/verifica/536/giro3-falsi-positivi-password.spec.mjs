// Verifica #536 — giro 3.
//
// LA PORTA: il giro 2 ha sistemato la parola «codice» (adesso serve un
// qualificatore inequivocabile, oppure qualcuno che chieda di passarlo). La
// metà gemella della stessa regola però è rimasta com'era: accanto alla parola
// «password» basta un gruppo di 4-8 cifre qualunque — un anno, un prezzo, un
// orario scritto senza i due punti — perché la risposta venga fermata. Nessun
// verbo richiesto, nessun qualificatore innocuo che valga.
//
// Cosa vede chi usa Filo: chiede «come si sceglie una password sicura», la
// risposta cita un anno (ogni articolo sull'argomento ne cita uno) e al suo
// posto compare «Ho fermato un avviso… conteneva una password». Per rileggerla
// deve sapere che esiste una voce nelle Preferenze e andarci.
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

const RISPOSTA = 'Dal 2025 le password da sole non bastano più: conviene aggiungere la verifica in due passaggi.';

test('una risposta su come scegliere una password non deve sparire', async ({ app, shell }) => {
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
      results: [{ title: 'Password sicure', url: 'https://guida-esempio.it/', snippet: 'come sceglierle' }],
    });
    // Il guardiano non ha niente da ridire: la frase è una guida, non una truffa.
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
          toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"password sicura"}' }],
        };
      }
      return { ...base, text: arg.risposta, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { risposta: RISPOSTA });

  await page.locator('#input').fill('cerca come si sceglie una password sicura');
  await page.locator('#sendBtn').click();

  const ultima = page.locator('.dash-bubble-filo').last();
  await expect(ultima).not.toHaveText('', { timeout: 30_000 });
  await expect(ultima, 'la risposta è stata fermata da un controllo automatico')
    .not.toContainText('Ho fermato');
  await expect(ultima).toContainText('due passaggi');
});
