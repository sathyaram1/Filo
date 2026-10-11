// #868 giro 11 — con un modello della chat dalla finestra piccola, rileggere una conversazione vecchia e lunga
// deve dare una risposta, come su main (dove la rilettura era di 8000 caratteri).
import { test, expect } from '../../fixtures/electron.mjs';

async function primaScheda(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('r1 rileggere una conversazione di giorni fa lunga 150.000 caratteri con un modello da 32.000 token dà una risposta', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await primaScheda(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [0, 0, 1]) });
    const E = globalThis.SN_FILO_EVENTI;
    const T = E.TIPI;
    const ora = Date.now();
    const ts = (oreFa, piu = 0) => new Date(ora - oreFa * 3600000 + piu).toISOString();
    const ev = [E.crea(T.CHAT_APERTA, { chat: 'trasloco' }, { ts: ts(120), dispositivo: 'prova', autore: 'utente' })];
    for (let i = 0; i < 60; i++) {
      ev.push(E.crea(T.MESSAGGIO, { chat: 'trasloco', msg: { role: 'user', text: `passo ${i} del trasloco?` } }, { ts: ts(120, i * 60000 + 1000), dispositivo: 'prova', autore: 'utente' }));
      ev.push(E.crea(T.MESSAGGIO, { chat: 'trasloco', msg: { role: 'filo', text: `passo ${i}: ${'scatoloni e nastro adesivo '.repeat(95)}` } }, { ts: ts(120, i * 60000 + 5000), dispositivo: 'prova', autore: 'filo' }));
    }
    ev.push(E.crea(T.CHAT_CHIUSA, { chat: 'trasloco' }, { ts: ts(119), dispositivo: 'prova', autore: 'utente' }));
    ev.push(E.crea(T.CHAT_TITOLO, { chat: 'trasloco', title: 'Il trasloco', kind: 'conversazione' }, { ts: ts(119), dispositivo: 'prova', autore: 'filo' }));
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
    globalThis.__rifiutate = 0;
    globalThis.__giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = messages.some((m) => m.role === 'user' && String(m.content).startsWith('═══ CONTESTO DI ADESSO'));
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      const n = messages.reduce((s, m) => s + String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).length, 0);
      if (n > 110000) {
        globalThis.__rifiutate++;
        const e = new Error(`OpenRouter 400: {"error":{"message":"This endpoint's maximum context length is 32768 tokens. However, you requested about ${Math.ceil(n / 3.5)} tokens. Please reduce the length of the messages.","code":400}}`);
        e.status = 400;
        throw e;
      }
      globalThis.__giro++;
      if (globalThis.__giro === 1) {
        return { ...base, text: '', toolCalls: [{ id: 't1', name: 'CERCA_CHAT', arguments: JSON.stringify({ id: 'trasloco' }) }], reasoningDetails: [], finishReason: 'tool_calls' };
      }
      try { onDelta && onDelta('Ecco il riassunto del trasloco.'); } catch (_) {}
      return { ...base, text: 'Ecco il riassunto del trasloco.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await page.locator('#input').fill('riassumimi la conversazione sul trasloco di qualche giorno fa');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco il riassunto del trasloco.' })).toBeVisible({ timeout: 30_000 });
});
