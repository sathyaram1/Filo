// #819 giro 2: esplorazione del verificatore (tema scuro, registro d'uso, chat senza listino, chiave propria, id grezzo).
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

async function listino(app, { rotto = false } = {}) {
  await app.evaluate((_e, { catalogo, rotto: giu }) => {
    const vero = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String((input && input.url) || input);
      if (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(url)) {
        if (giu) return new Response('giù', { status: 503 });
        const data = url.includes('output_modalities') ? [] : catalogo;
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return vero(input, init);
    };
  }, { catalogo: CATALOGO, rotto });
}
async function configura(app, extra = {}) {
  await app.evaluate(async (_e, x) => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      modelRegistry: { ...T.registry, opus: x.opus },
      models: { ...T.models, ...(x.models || {}) },
      apiKeys: { openrouter: x.chiave || '' },
      ...(x.altro || {}),
    });
  }, { opus: OPUS, ...extra });
}
const cellaDi = (page, nome) => page.locator('#modelsGrid > div').filter({ has: page.locator('label', { hasText: nome }) });

test('tema scuro: cifra, tendina e avviso', async ({ app, openTab }) => {
  await listino(app);
  await configura(app, { models: { filo_chat: 'opus, gemma' }, altro: { theme: 'dark' } });
  const page = await openTab(OPTIONS_URL);
  await page.emulateMedia({ colorScheme: 'dark' });
  const chat = cellaDi(page, CHAT);
  await expect(chat.locator('.sn-chain-costo')).toContainText('bastano', { timeout: 8_000 });
  await chat.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/819-g2-scuro.png' });
  await chat.locator('.sn-chain-input').nth(1).focus();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/819-g2-scuro-tendina.png' });
});

test('registro d\'uso: dopo tre messaggi la stima segue i token veri', async ({ app, openTab }) => {
  await listino(app);
  await configura(app);
  await app.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      await globalThis.SN_COSTS.record({ action: 'filo_chat', provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', usage: { promptTokens: 2000, completionTokens: 100 }, pricing: null, usdToEur: 0.92 });
    }
  });
  const page = await openTab(OPTIONS_URL);
  const costo = cellaDi(page, CHAT).locator('.sn-chain-cost').first();
  await expect(costo).toHaveText('≈ 1 credito', { timeout: 8_000 });
  await expect(costo).toHaveAttribute('title', /token medi dei tuoi ultimi messaggi/);
});

async function homeDi(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab') && !w.url().includes('incognito'); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    globalThis.__costo_tool = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__costo_tool.push(String(ultimo.content || ''));
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, giri);
}
const cambia = (valore) => ({ toolCalls: [{ id: 'm1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modello_funzione', valore }) }] });
async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

for (const caso of [
  { nome: 'listino giù', rotto: true, fonte: 'factory', valore: 'Chat con Filo: opus', atteso: /Listino di OpenRouter non disponibile/, salvato: 'opus' },
  { nome: 'chiave propria', fonte: 'own', valore: 'Chat con Filo: opus', atteso: /Circa 0,1 \$ per messaggio/, no: /bastano|crediti/, salvato: 'opus' },
  { nome: 'id grezzo', fonte: 'factory', valore: 'Chat con Filo: anthropic/claude-opus-4.5', atteso: /Circa 118 crediti per messaggio\. Con anthropic\/claude-opus-4\.5 i tuoi/, salvato: 'anthropic/claude-opus-4.5' },
  { nome: 'catena di due', fonte: 'factory', valore: 'Chat con Filo: opus, deepseek-flash', atteso: /opus: circa 118 crediti per messaggio; deepseek-flash: /, salvato: 'opus, deepseek-flash' },
]) {
  test(`chat: ${caso.nome}`, async ({ app, shell }) => {
    test.setTimeout(60_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const chat = await homeDi(app);
    await listino(app, { rotto: caso.rotto });
    await configura(app, { chiave: 'k-test', models: { filo_chat: 'deepseek-flash' } });
    await app.evaluate((_e, f) => { globalThis.SN_WALLET_MAIN.keySource = async () => f; }, caso.fonte);
    await modelloFinto(app, [cambia(caso.valore), { text: 'Fatto.' }]);
    await scrivi(chat, 'cambia il modello della chat');
    await expect(chat.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 15_000 });
    const esito = (await app.evaluate(() => globalThis.__costo_tool)).join('\n');
    console.log(caso.nome, '→', esito.slice(0, 600));
    expect(esito).toMatch(caso.atteso);
    if (caso.no) expect(esito).not.toMatch(caso.no);
    await expect.poll(async () => (await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).models.filo_chat, { timeout: 5_000 }).toBe(caso.salvato);
  });
}
