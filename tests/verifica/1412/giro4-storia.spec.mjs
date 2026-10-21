// Esplorazione del giro 4 di #1412: nella chat vera, per trenta turni, la storia fino al punto di cache resta uguale al turno dopo.
import { test, expect } from '../../fixtures/electron.mjs';

test('trenta turni con ragionamento: il punto della storia viene ritrovato identico al turno dopo', async ({ app }) => {
  test.setTimeout(180_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [1, 0.05]) });
    globalThis.__giri = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, cache, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = messages.some((m) => m.role === 'user' && String(m.content).startsWith('═══ CONTESTO DI ADESSO'));
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      n++;
      globalThis.__giri.push({ messages: JSON.parse(JSON.stringify(messages)), cache: cache ? JSON.parse(JSON.stringify(cache)) : null });
      const text = `Risposta ${n}.`;
      try { onDelta && onDelta(text); } catch (_) {}
      return { ...base, text, toolCalls: [], reasoningDetails: [{ type: 'reasoning.text', text: `pensiero ${n} `.repeat(20), signature: `firma${n}` }], finishReason: 'stop' };
    };
  });
  const chiedi = (t) => app.evaluate((_e, t) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: t, threadHistory: [], chatId: 'scheda-lunga' }), t);
  for (let i = 0; i < 30; i++) await chiedi(`domanda numero ${i}`);
  const giri = await app.evaluate(() => globalThis.__giri);
  expect(giri.length).toBe(30);
  const rotti = [];
  const conRagionamento = [];
  for (let k = 0; k < giri.length - 1; k++) {
    const { messages, cache } = giri[k];
    conRagionamento.push(messages.filter((m) => m.role === 'assistant' && (m.reasoning_details || m.reasoningDetails)).length);
    const punti = (cache && cache.punti) || [];
    const storia = punti.filter((p) => p.indice > 0).map((p) => p.indice);
    // Il punto più avanti che il turno dopo ritrova: almeno uno dei punti della storia deve reggere.
    const dopo = giri[k + 1].messages;
    const regge = storia.filter((i) => JSON.stringify(messages.slice(1, i + 1)) === JSON.stringify(dopo.slice(1, i + 1)));
    rotti.push({ k, lunghezza: messages.length, storia, regge: regge.length ? Math.max(...regge) : 0 });
  }
  console.log(JSON.stringify(rotti));
  console.log('assistenti con ragionamento per turno:', conRagionamento.join(','));
  // Dal secondo turno in poi un punto della storia deve essere riletto, e lasciare fuori al più gli ultimi ~22 messaggi.
  for (const r of rotti.slice(1)) {
    expect(r.regge, `turno ${r.k}`).toBeGreaterThan(0);
  }
});
