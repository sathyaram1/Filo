// Verifica #1589 giro 13, rilievo 1: un segreto scritto come valore di una chiave di configurazione col nome della chiave
// («PGPASSWORD», «SECRET_KEY», «api_key», «Chiave API») arriva al modello quando il valore non ha il prefisso di un servizio noto.
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

test('r1 un file .env mostrato in una pagina: le chiavi e le password per nome non arrivano al modello', async ({ app, openTab, testServer }) => {
  const fx = { app, openTab, testServer };
  test.setTimeout(90_000);
  const mandato = await leggiInChat(fx, 'Configurazione del progetto', `<h1>Configurazione del progetto</h1>
    <pre>APP_NAME=gestionale
PGPASSWORD=Girasole2024
SECRET_KEY=django-insecure-8h3k2j4h5g6f7d8s9a0
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
api_key=8f14e45fceea167a5a36dedd4bea2543
client_secret=GOCSPX-1a2B3c4D5e6F7g8H9i0J</pre>`, 'dalla pagina Configurazione del progetto: cosa fa questo file?');
  expect(mandato, 'la pagina è stata letta').toContain('APP_NAME=gestionale');
  for (const s of ['Girasole2024', 'django-insecure-8h3k2j4h5g6f7d8s9a0', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    '8f14e45fceea167a5a36dedd4bea2543', 'GOCSPX-1a2B3c4D5e6F7g8H9i0J']) expect(mandato, s).not.toContain(s);
});

test('r1 la pagina di un servizio con «Chiave API»: la chiave non arriva al modello', async ({ app, openTab, testServer }) => {
  const fx = { app, openTab, testServer };
  test.setTimeout(90_000);
  const mandato = await leggiInChat(fx, 'Il tuo account meteo', `<h1>Il tuo account meteo</h1>
    <p>Piano: gratuito</p><p>Chiave API: 8f14e45fceea167a5a36dedd4bea2543</p><button>Copia</button>`,
  'dalla pagina Il tuo account meteo: che piano ho?');
  expect(mandato, 'la pagina è stata letta').toContain('Piano: gratuito');
  expect(mandato).not.toContain('8f14e45fceea167a5a36dedd4bea2543');
});
