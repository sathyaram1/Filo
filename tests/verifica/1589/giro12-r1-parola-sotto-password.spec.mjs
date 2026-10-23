// Verifica #1589 giro 12, rilievo 1: la parola sotto «Password» (dopo i puntini e «Modifica») viene presa per la password e
// sparisce davanti al modello in tutta la pagina, ovunque compaia la stessa parola.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 la chat legge la pagina «Accesso e sicurezza»: la voce «Telefono» sotto la password arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const h = await openTab('filo://newtab/');
  const url = testServer.html(`<!doctype html><html><head><title>Accesso e sicurezza</title></head><body><main>
    <h1>Accesso e sicurezza</h1>
    <div><div>Nome</div><div>Mario Rossi</div><button>Modifica</button></div>
    <div><div>Email</div><div>mario@example.com</div><button>Modifica</button></div>
    <div><div>Password</div><div>••••••••</div><button>Modifica</button></div>
    <div><div>Telefono</div><div>+39 333 1234567</div><button>Modifica</button></div>
    <p>Aggiungi un Telefono di riserva per recuperare l'account se perdi l'accesso.</p>
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
        const m = /(\d+)\. (?:\[FOCUS\] )?Accesso e sicurezza/.exec(messages.map((x) => String(x.content || '')).join('\n'));
        const call = { id: 'c0', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ scheda: m ? Number(m[1]) : 0 }) };
        try { onToolCall && onToolCall({ id: call.id, name: call.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [call], finishReason: 'tool_calls' };
      }
      try { onDelta && onDelta('LETTA'); } catch (_) {}
      return { ...base, text: 'LETTA', toolCalls: [], finishReason: 'stop' };
    };
  });
  await h.bringToFront();
  await h.locator('#input').fill('dalla pagina Accesso e sicurezza: come cambio il numero di telefono?');
  await h.locator('#sendBtn').click();
  await expect(h.locator('.dash-bubble-filo', { hasText: 'LETTA' })).toBeVisible({ timeout: 20_000 });
  const mandato = (await app.evaluate(() => globalThis.__chiamate)).join('\n');
  expect(mandato, 'la pagina è stata letta').toContain('mario@example.com');
  expect(mandato.replace(/\\n/g, '\n')).toMatch(/Telefono\s+\+39 333 1234567/);
  expect(mandato).toContain('Aggiungi un Telefono di riserva');
});
