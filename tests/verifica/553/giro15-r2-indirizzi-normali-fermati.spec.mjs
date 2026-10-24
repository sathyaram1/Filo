// Verifica #553, giro 15: una pagina di documentazione o di Wikipedia che il modello conosce si legge senza l'avviso
// di dati in uscita, anche quando il suo nome è una parola composta lunga o è scritto in un alfabeto non latino.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function stubModello(app, url) {
  await app.evaluate(async (_e, url) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate++;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (n === 0) {
        try { onToolCall && onToolCall({ id: 'c0', name: 'LEGGI_PAGINA' }); } catch (_) {}
        return { ...base, text: '', toolCalls: [{ id: 'c0', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ url }) }], finishReason: 'tool_calls' };
      }
      const esiti = messages.map((m) => String(m.content || '')).join('\n');
      const m = /VALORE_LETTO_(\d+)/.exec(esiti);
      const text = `RISPOSTA: ${m ? m[1] : 'NON_TROVATO'}`;
      try { onDelta && onDelta(text); } catch (_) {}
      return { ...base, text, toolCalls: [], finishReason: 'stop' };
    };
  }, url);
}

async function reteFinta(app) {
  await app.evaluate(() => {
    globalThis.__scaricati = [];
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async (url) => {
      globalThis.__scaricati.push(url);
      return new Response(`<!doctype html><html><head><title>Documentazione</title></head><body><main><h1>Voce</h1>
<p>Il testo della voce che il modello voleva leggere, con il dato che serve alla risposta: VALORE_LETTO_42.</p></main></body></html>`,
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
  });
}

for (const [nome, domanda, url] of [
  ['la documentazione di un metodo dal nome composto', 'come funziona getBoundingClientRect?', 'https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect'],
  ['una voce di Wikipedia in russo', 'cosa dice la wikipedia russa sulla grande guerra patriottica?', 'https://ru.wikipedia.org/wiki/Великая_Отечественная_война'],
]) {
  test(`${nome} si legge senza l'avviso di dati in uscita`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    const page = await openTab(NEWTAB);
    await reteFinta(app);
    await stubModello(app, url);
    await page.locator('#input').fill(domanda);
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA: 42' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.dash-bubble-actions .dash-action-btn-primary')).toHaveCount(0);
  });
}
