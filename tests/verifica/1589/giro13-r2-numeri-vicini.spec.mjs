// Verifica #1589 giro 13, rilievo 2: un numero che sta solo vicino alla parola codice o password (il telefono a cui è
// partito il codice, il numero dell'assistenza, la data dell'ultima modifica) arriva al modello coperto.
import { test, expect } from '../../fixtures/electron.mjs';

test('r2 la pagina del codice di verifica: il telefono e l\'assistenza arrivano al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const titolo = 'Verifica il tuo accesso';
  const h = await openTab('filo://newtab/');
  const url = testServer.html(`<!doctype html><html><head><title>${titolo}</title></head><body><main>
    <h1>${titolo}</h1>
    <p>Ti abbiamo inviato un codice di verifica al numero +39 333 1234567</p>
    <label>Codice <input type="text" name="otp"></label>
    <p>Password ultima modifica: 12 mar 2024</p>
    <p>Non hai ricevuto il codice? Chiama 02 4829 1736</p>
    </main></body></html>`, { pubblico: true });
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
        const m = /(\d+)\. (?:\[FOCUS\] )?Verifica il tuo accesso/.exec(messages.map((x) => String(x.content || '')).join('\n'));
        const call = { id: 'c0', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ scheda: m ? Number(m[1]) : 0 }) };
        try { onToolCall && onToolCall({ id: call.id, name: call.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [call], finishReason: 'tool_calls' };
      }
      try { onDelta && onDelta('LETTA'); } catch (_) {}
      return { ...base, text: 'LETTA', toolCalls: [], finishReason: 'stop' };
    };
  });
  await h.bringToFront();
  await h.locator('#input').fill('dalla pagina Verifica il tuo accesso: a che numero è arrivato il codice?');
  await h.locator('#sendBtn').click();
  await expect(h.locator('.dash-bubble-filo', { hasText: 'LETTA' })).toBeVisible({ timeout: 20_000 });
  const mandato = (await app.evaluate(() => globalThis.__chiamate)).join('\n');
  expect(mandato, 'la pagina è stata letta').toContain('Ti abbiamo inviato un codice di verifica');
  expect(mandato).toContain('+39 333 1234567');
  expect(mandato).toContain('02 4829 1736');
  expect(mandato).toContain('12 mar 2024');
});
