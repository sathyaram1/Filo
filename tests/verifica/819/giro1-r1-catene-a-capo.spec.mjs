// #819 giro 1, rilievo 1: la cifra del costo accanto ai modelli non deve mandare a capo le catene delle Opzioni.
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

test('r1 la cifra del costo non manda a capo una catena che senza ci stava su una riga', async ({ app, openTab }) => {
  await listino(app);
  await configura(app);
  const page = await openTab(OPTIONS_URL);
  await expect(cellaDi(page, CHAT).locator('.sn-chain-cost').first()).toHaveText('≈ 8,2 crediti', { timeout: 8_000 });
  const righe = () => page.evaluate(() => [...document.querySelectorAll('#modelsGrid > div')].map((cell) => {
    const segs = [...cell.querySelectorAll('.sn-chain-seg')];
    return { nome: (cell.querySelector('label') || {}).textContent, segs: segs.length, righe: new Set(segs.map((s) => Math.round(s.getBoundingClientRect().top))).size };
  }).filter((x) => x.segs > 1));
  const con = await righe();
  await page.addStyleTag({ content: '.sn-chain-cost{display:none!important}' });
  await page.waitForTimeout(300);
  const senza = await righe();
  expect(con.length).toBeGreaterThan(10);
  expect(con.filter((c, k) => c.righe > senza[k].righe).map((c) => c.nome)).toEqual([]);
});
