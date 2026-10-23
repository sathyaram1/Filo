// Verifica #1589 giro 14, rilievi 3 e 4: testi che non sono segreti spariscono al modello perché stanno vicino alla
// parola password o codice: le etichette e i tempi di un file di configurazione, il codice, le cifre finali di un telefono.
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

test('r3 un file di traduzioni e un pezzo di codice con la parola password arrivano al modello come sono', async ({ app, openTab, testServer }) => {
  const fx = { app, openTab, testServer };
  test.setTimeout(90_000);
  const mandato = await leggiInChat(fx, 'Traduzioni del modulo di accesso', `<h1>Traduzioni del modulo di accesso</h1>
    <pre>{
  "password_label": "Inserisci la password",
  "forgot_password": "Password dimenticata?",
  "password_hint": "Almeno otto caratteri"
}
password_reset_timeout: 3600
cache_ttl: 3600</pre>
    <pre>def login(username: str, password: str) -> bool:
    password = input("Password: ")</pre>`, 'dalla pagina Traduzioni del modulo di accesso: spiegami il file');
  expect(mandato, 'la pagina è stata letta').toContain('password_label');
  for (const s of ['Inserisci la password', 'Password dimenticata?', 'Almeno otto caratteri', 'cache_ttl: 3600', 'password: str)', 'input(']) {
    expect(mandato, s).toContain(s);
  }
});

test('r4 la pagina di verifica dell\'accesso: le cifre finali del telefono a cui è partito il codice arrivano al modello', async ({ app, openTab, testServer }) => {
  const fx = { app, openTab, testServer };
  test.setTimeout(90_000);
  const mandato = await leggiInChat(fx, 'Verifica in due passaggi', `<h1>Verifica in due passaggi</h1>
    <p>Abbiamo inviato un codice al numero che termina con 4567.</p>
    <p>Non è il tuo numero? Abbiamo inviato un codice anche al ***8812</p>`, 'dalla pagina Verifica in due passaggi: a che numero è arrivato il codice?');
  expect(mandato, 'la pagina è stata letta').toContain('Verifica in due passaggi');
  expect(mandato).toContain('termina con 4567');
  expect(mandato).toContain('***8812');
});
