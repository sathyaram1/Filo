// Verifica #1589 giro 14, rilievo 1: chiavi e codici con una forma inconfondibile (il corpo di una chiave privata, un
// la password di una riga di comando, la lista dei codici di recupero) arrivano al modello.
import { test, expect } from '../../fixtures/electron.mjs';

async function leggiInChat({ app, openTab, testServer }, titolo, corpo, domanda) {
  const h = await openTab('filo://newtab/');
  const url = testServer.html(`<!doctype html><html><head><title>${titolo}</title></head><body><main>${corpo}</main></body></html>`, { pubblico: true });
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  await app.evaluate(async (_e, titolo) => {
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
        const esc = titolo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = new RegExp(`(\\d+)\\. (?:\\[FOCUS\\] )?${esc}`).exec(messages.map((x) => String(x.content || '')).join('\n'));
        const call = { id: 'c0', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ scheda: m ? Number(m[1]) : 0 }) };
        try { onToolCall && onToolCall({ id: call.id, name: call.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [call], finishReason: 'tool_calls' };
      }
      try { onDelta && onDelta('LETTA'); } catch (_) {}
      return { ...base, text: 'LETTA', toolCalls: [], finishReason: 'stop' };
    };
  }, titolo);
  await h.bringToFront();
  await h.locator('#input').fill(domanda);
  await h.locator('#sendBtn').click();
  await expect(h.locator('.dash-bubble-filo', { hasText: 'LETTA' })).toBeVisible({ timeout: 20_000 });
  return (await app.evaluate(() => globalThis.__chiamate)).join('\n');
}

test('r1 la chiave SSH stampata nel terminale o mostrata in una pagina: il suo corpo non arriva al modello', async ({ app, openTab, testServer }) => {
  const fx = { app, openTab, testServer };
  test.setTimeout(90_000);
  const mandato = await leggiInChat(fx, 'Le mie chiavi del server', `<h1>Le mie chiavi del server</h1>
    <p>File: id_ed25519</p>
    <pre>-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDkBvTqjD8mY3Jv5nQ2sXkzT7a9yH0b1fLqW3eR5cN4wAAAAJgK9XhGCvV4
-----END OPENSSH PRIVATE KEY-----</pre>
    <p>File: id_rsa</p>
    <pre>-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAx5mT2rXyQ4pQe9yLk3Vv8pZq1wF8aB2cD3eF4gH5iJ6kL7mN8oP9
qR0sT1uV2wX3yZ4aB5cD6eF7gH8iJ9kL0mN1oP2qR3sT4uV5wX6yZ7aB8cD9eF0gH1iJ
-----END RSA PRIVATE KEY-----</pre>`, 'dalla pagina Le mie chiavi del server: che tipo di chiavi sono?');
  expect(mandato, 'la pagina è stata letta').toContain('id_ed25519');
  for (const s of ['b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ', 'QyNTUxOQAAACDkBvTqjD8mY3Jv5nQ2sXkzT7a9yH0b1fLqW3eR5cN4w',
    'MIIEpAIBAAKCAQEAx5mT2rXyQ4pQe9yLk3Vv8pZq1wF8aB2cD3eF4gH5iJ6kL7mN8oP9', 'qR0sT1uV2wX3yZ4aB5cD6eF7gH8iJ9kL0mN1oP2qR3sT4uV5wX6yZ7aB8cD9eF0gH1iJ']) {
    expect(mandato, s).not.toContain(s);
  }
});

test('r1 la password di una riga di comando e i codici di recupero non arrivano al modello', async ({ app, openTab, testServer }) => {
  const fx = { app, openTab, testServer };
  test.setTimeout(90_000);
  const mandato = await leggiInChat(fx, 'Note di installazione', `<h1>Note di installazione</h1>
    <pre>APP_NAME=gestionale
docker login -u mario -p Faro7Blu2024 registry.example.com
curl -u mario:Ponte9Grigio https://api.example.com/v1/stato</pre>
    <h2>Codici di recupero</h2>
    <pre>3f9a1-b2c7d
8e4d0-a6f15
c1b7e-90d2a
77d3f-1e0b9</pre>`, 'dalla pagina Note di installazione: cosa devo fare?');
  expect(mandato, 'la pagina è stata letta').toContain('APP_NAME=gestionale');
  for (const s of ['Faro7Blu2024', 'Ponte9Grigio', 'c1b7e-90d2a', '77d3f-1e0b9']) expect(mandato, s).not.toContain(s);
});
