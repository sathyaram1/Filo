// Verifica #1589 giro 11, rilievo 1: una password scritta come valore in un file di configurazione (JSON, .env, XML)
// arriva al modello quando la chat legge la pagina.
import { test, expect } from '../../fixtures/electron.mjs';

async function leggiInChat(app, openTab, testServer, corpo) {
  const h = await openTab('filo://newtab/');
  const url = testServer.html(`<!doctype html><html><head><title>Configurazione</title></head><body><main>
    <h1>File di configurazione del progetto</h1>${corpo}</main></body></html>`, { pubblico: true });
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
        const m = /(\d+)\. (?:\[FOCUS\] )?Configurazione/.exec(messages.map((x) => String(x.content || '')).join('\n'));
        const call = { id: 'c0', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ scheda: m ? Number(m[1]) : 0 }) };
        try { onToolCall && onToolCall({ id: call.id, name: call.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [call], finishReason: 'tool_calls' };
      }
      try { onDelta && onDelta('LETTA'); } catch (_) {}
      return { ...base, text: 'LETTA', toolCalls: [], finishReason: 'stop' };
    };
  });
  await h.bringToFront();
  await h.locator('#input').fill('leggi la pagina Configurazione e dimmi come si collega al database');
  await h.locator('#sendBtn').click();
  await expect(h.locator('.dash-bubble-filo', { hasText: 'LETTA' })).toBeVisible({ timeout: 20_000 });
  const mandato = (await app.evaluate(() => globalThis.__chiamate)).join('\n');
  expect(mandato, 'la pagina è stata letta').toContain('File di configurazione del progetto');
  return mandato;
}

test('r1 la chat legge un file JSON con la password come valore: la password non arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat(app, openTab, testServer,
    '<pre>{ "username": "mario", "password": "Girasole2024", "host": "db.locale" }</pre>');
  expect(mandato).not.toContain('Girasole2024');
});

test('r1 la chat legge un file .env: la password della variabile non arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat(app, openTab, testServer,
    '<pre>DB_HOST=db.locale\nDB_USER=mario\nDB_PASSWORD=Ponte9Grigio\nPOSTGRES_PASSWORD: Faro7Blu</pre>');
  expect(mandato).not.toContain('Ponte9Grigio');
  expect(mandato).not.toContain('Faro7Blu');
});

test('r1 la chat legge un file XML: la password nell’elemento non arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat(app, openTab, testServer,
    '<pre>&lt;utente&gt;mario&lt;/utente&gt;\n&lt;password&gt;Nuvola2023x&lt;/password&gt;</pre>');
  expect(mandato).not.toContain('Nuvola2023x');
});
