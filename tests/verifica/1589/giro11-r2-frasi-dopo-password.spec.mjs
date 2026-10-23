// Verifica #1589 giro 11, rilievo 2: una frase dopo «Password:» che dice dove trovarla o come sceglierla sparisce
// davanti al modello come se fosse la password.
import { test, expect } from '../../fixtures/electron.mjs';

test('r2 la chat legge la pagina di un hotel: «disponibile alla reception» e le regole della password arrivano al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const h = await openTab('filo://newtab/');
  const url = testServer.html(`<!doctype html><html><head><title>Hotel Roma</title></head><body><main>
    <h1>Informazioni per gli ospiti</h1>
    <p>Rete Wi-Fi: HotelRoma-Ospiti</p>
    <p>Password Wi-Fi: disponibile alla reception</p>
    <p>Password del portale ospiti: sul retro della chiave magnetica</p>
    <h2>Registrati</h2>
    <p>Password: deve avere almeno otto caratteri</p>
    <p>Password: min. 8 caratteri</p></main></body></html>`, { pubblico: true });
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
        const m = /(\d+)\. (?:\[FOCUS\] )?Hotel Roma/.exec(messages.map((x) => String(x.content || '')).join('\n'));
        const call = { id: 'c0', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ scheda: m ? Number(m[1]) : 0 }) };
        try { onToolCall && onToolCall({ id: call.id, name: call.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [call], finishReason: 'tool_calls' };
      }
      try { onDelta && onDelta('LETTA'); } catch (_) {}
      return { ...base, text: 'LETTA', toolCalls: [], finishReason: 'stop' };
    };
  });
  await h.bringToFront();
  await h.locator('#input').fill('dalla pagina Hotel Roma: dove trovo la password del wifi?');
  await h.locator('#sendBtn').click();
  await expect(h.locator('.dash-bubble-filo', { hasText: 'LETTA' })).toBeVisible({ timeout: 20_000 });
  const mandato = (await app.evaluate(() => globalThis.__chiamate)).join('\n');
  expect(mandato, 'la pagina è stata letta').toContain('Informazioni per gli ospiti');
  expect(mandato).toContain('disponibile alla reception');
  expect(mandato).toContain('sul retro della chiave magnetica');
  expect(mandato).toContain('deve avere almeno otto caratteri');
  expect(mandato).toContain('min. 8 caratteri');
});
