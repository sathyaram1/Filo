// Esplorazione della verifica #1461 giro 7: richiesta ripetuta, prima volta, documento dell'ora valido.
import { test, expect } from '../../fixtures/electron.mjs';

const ora = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const k = globalThis.SN_CONTATORI.oraDi(Date.now());
  return { k, dati: s.ore[k] || null, mesi: s.mesi };
});

test('esplora: ripetuta, prima volta e validità del documento', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test' }, modelRegistry: T.registry, models: { ...T.models } });
    globalThis.__fv = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (/endpoints$/.test(u)) return new Response(JSON.stringify({ data: { endpoints: [{ provider_name: 'DeepInfra', tag: 'deepinfra', supported_parameters: ['max_tokens'], max_completion_tokens: 65536 }] } }), { status: 200 });
      if (!u.includes('chat/completions')) return globalThis.__fv(url, init);
      const body = JSON.parse(init.body);
      if (body.stream) return new Response(`data: ${JSON.stringify({ provider: 'DeepInfra', choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      return new Response(JSON.stringify({ provider: 'DeepInfra', choices: [{ message: { content: 'ok' } }], usage: {} }), { status: 200 });
    };
  });
  const spiega = (t) => app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    return globalThis.__filoHandlers.handleStream({ action: C.ACTIONS.EXPLAIN, payload: { messages: [{ role: 'user', content: t }] }, origin: 'test', onDelta: () => {} }).then(() => 'ok', (e) => String(e.message || e));
  }, t);
  expect(await spiega('uno')).toBe('ok');
  expect(await spiega('due')).toBe('ok');
  await expect.poll(async () => (await ora(app)).dati?.uso?.explain?.n || 0, { timeout: 8000 }).toBe(2);
  const o = await ora(app);
  console.log('USO', JSON.stringify(o.dati.uso.explain), 'PRIME', JSON.stringify(o.dati.primeVolte), 'MESI', JSON.stringify(o.mesi));
  // Più cose nell'ora: una pagina di Filo, un'impostazione, una scheda nuova.
  await shell.keyboard.press('Control+t');
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: 'dark' } }));
  await new Promise((r) => setTimeout(r, 4000));
  const v = await app.evaluate(async () => {
    const C = globalThis.SN_CONTATORI;
    const s = await globalThis.SN_CONTATORI_MAIN.letto();
    const k = C.oraDi(Date.now());
    const doc = C.documento({ pseudonimo: 'a'.repeat(20), chiave: k, app: '1.2.3', os: C.famigliaOs(process.platform), dati: s.ore[k], primo: 'mese' });
    return { v: C.valida(doc), chiavi: Object.keys(doc), dim: JSON.stringify(doc).length, doc };
  });
  console.log('VALIDA', JSON.stringify(v.v), v.dim, JSON.stringify(v.doc).slice(0, 3000));
  expect(v.v.ok).toBe(true);
  expect(o.dati.uso.explain.rip || 0).toBe(1);
});
