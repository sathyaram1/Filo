// Verifica #1589 giro 12, rilievo 1: la voce di menu sotto «Password» viene presa per la password e sparisce davanti al
// modello in tutta la pagina, ovunque compaia la stessa parola.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 la chat legge la pagina del mio account: «Ordini» e «Notifiche» arrivano al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const h = await openTab('filo://newtab/');
  const url = testServer.html(`<!doctype html><html><head><title>Il mio account</title></head><body>
    <nav><ul><li><a href="#">Dati personali</a></li><li><a href="#">Indirizzi</a></li><li><a href="#">Password</a></li>
    <li><a href="#">Ordini</a></li><li><a href="#">Notifiche</a></li></ul></nav>
    <main><h1>Ordini recenti</h1><p>Nessun ordine. I tuoi Ordini compariranno qui.</p>
    <h2>Notifiche</h2><p>Scegli quali Notifiche ricevere per email.</p></main></body></html>`, { pubblico: true });
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate.push(JSON.stringify(messages)) - 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (n === 0) {
        const m = /(\d+)\. (?:\[FOCUS\] )?Il mio account/.exec(messages.map((x) => String(x.content || '')).join('\n'));
        const call = { id: 'c0', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ scheda: m ? Number(m[1]) : 0 }) };
        try { onToolCall && onToolCall({ id: call.id, name: call.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [call], finishReason: 'tool_calls' };
      }
      try { onDelta && onDelta('LETTA'); } catch (_) {}
      return { ...base, text: 'LETTA', toolCalls: [], finishReason: 'stop' };
    };
  });
  await h.bringToFront();
  await h.locator('#input').fill('dalla pagina Il mio account: dove vedo i miei ordini?');
  await h.locator('#sendBtn').click();
  await expect(h.locator('.dash-bubble-filo', { hasText: 'LETTA' })).toBeVisible({ timeout: 20_000 });
  const mandato = (await app.evaluate(() => globalThis.__chiamate)).join('\n');
  expect(mandato, 'la pagina è stata letta').toContain('Dati personali');
  expect(mandato).toContain('I tuoi Ordini compariranno qui');
  expect(mandato).toContain('Scegli quali Notifiche ricevere');
  expect(mandato).not.toContain('[dato riservato]');
});
