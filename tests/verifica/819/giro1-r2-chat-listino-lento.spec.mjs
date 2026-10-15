// #819 giro 1, rilievo 2: il cambio di modello chiesto in chat dice sempre il costo, o che non lo sa, anche col listino lento.
import { test, expect } from '../../fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';
const CHAT = 'Home — chat con Filo';
const CATALOGO = [
  { id: 'deepseek/deepseek-v4-pro', pricing: { prompt: '0.0000004', completion: '0.0000008' } },
  { id: 'deepseek/deepseek-v4-flash', pricing: { prompt: '0.00000009', completion: '0.00000018' } },
  { id: 'google/gemma-4-31b-it', pricing: { prompt: '0.0000001', completion: '0.0000003' } },
  { id: 'google/gemma-4-26b-a4b-it', pricing: { prompt: '0.00000004', completion: '0.00000012' } },
  { id: 'anthropic/claude-haiku-4.5', pricing: { prompt: '0.000001', completion: '0.000005' } },
  { id: 'anthropic/claude-opus-4.5', pricing: { prompt: '0.000005', completion: '0.000025' } },
];
const OPUS = { label: 'Claude Opus 4.5', provider: 'openrouter', model: 'anthropic/claude-opus-4.5', inputs: ['text', 'image'], outputs: ['text'] };
const HAIKU = { label: 'Claude Haiku 4.5', provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', inputs: ['text', 'image'], outputs: ['text'] };

async function listino(app, { lento = 0 } = {}) {
  await app.evaluate((_e, { catalogo, lento: ms }) => {
    const vero = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String((input && input.url) || input);
      if (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(url)) {
        if (ms) await new Promise((r) => setTimeout(r, ms));
        const data = url.includes('output_modalities') ? [] : catalogo;
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return vero(input, init);
    };
  }, { catalogo: CATALOGO, lento });
}
async function configura(app, extra = {}) {
  await app.evaluate(async (_e, x) => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      modelRegistry: { ...T.registry, opus: x.opus, haiku: x.haiku },
      models: { ...T.models, ...(x.models || {}) },
      apiKeys: { openrouter: x.chiave || '' },
      ...(x.theme ? { theme: x.theme } : {}),
    });
  }, { opus: OPUS, haiku: HAIKU, ...extra });
}
const cellaDi = (page, nome) => page.locator('#modelsGrid > div').filter({ has: page.locator('label', { hasText: nome }) });

async function homeDi(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab') && !w.url().includes('incognito'); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

test('r2 col listino lento il cambio in chat dice il costo o perché non lo dice', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await listino(app, { lento: 6000 });
  await configura(app, { chiave: 'k-test', models: { filo_chat: 'deepseek-flash' } });
  await app.evaluate(() => { globalThis.SN_WALLET_MAIN.keySource = async () => 'factory'; });
  await app.evaluate(async () => {
    globalThis.__costo_tool = [];
    let n = 0;
    const giri = [
      { toolCalls: [{ id: 'm1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modello_funzione', valore: 'Chat con Filo: opus' }) }] },
      { text: 'Fatto.' },
    ];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = giri[Math.min(n, giri.length - 1)]; n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__costo_tool.push(String(ultimo.content || ''));
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  });
  await chat.bringToFront();
  await chat.locator('#input').fill('usa opus per la chat');
  await chat.locator('#sendBtn').click();
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).models.filo_chat, { timeout: 5_000 }).toBe('opus');
  const esito = (await app.evaluate(() => globalThis.__costo_tool)).join('\n');
  expect(esito).toMatch(/crediti per messaggio|[Ll]istino/);
  await expect(chat.locator('.dash-activity', { hasText: /crediti per messaggio|[Ll]istino/ }).first()).toBeAttached({ timeout: 5_000 });
});
