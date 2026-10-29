// Verifica #1596 giro 3: esplorazione (più turni con una pagina ciascuno, aspetto dell'avviso).
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const URL_RE = 'http://127\\.0\\.0\\.1:\\d+/\\d+';
const MARCHI = ['ALFA', 'BETA', 'GAMMA'];
const FINESTRA = 72000;

function paginaEnorme(nome) {
  const riga = `Paragrafo della pagina ${nome} con dati, prezzi e orari da leggere con calma prima di rispondere. `;
  const corpo = Array.from({ length: 2200 }, (_, i) => `<p>${i}. ${riga}</p>`).join('\n');
  return `<!doctype html><html lang="it"><head><title>Guida ${nome}</title></head><body><main><article>
<h1>Guida ${nome}</h1><p>MARCHIO_${nome}: il dato che serve sta qui.</p>
${corpo}
</article></main></body></html>`;
}

async function modello(app, { finestra = 0, posto = 0, listino = false, misure = true, piani }) {
  await app.evaluate(async (_e, { finestra, posto, listino, misure, piani }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const vero = globalThis.__fetchVeroListino || globalThis.fetch;
    globalThis.__fetchVeroListino = vero;
    globalThis.fetch = async (input, init) => {
      const url = String((input && input.url) || input);
      if (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(url)) {
        if (!listino) return new Response('giù', { status: 503 });
        const data = url.includes('output_modalities') ? [] : [{ id: 'deepseek/deepseek-v4-flash', context_length: finestra, pricing: { prompt: '0.0000001', completion: '0.0000002' } }];
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return vero(input, init);
    };
    globalThis.__rifiutate = 0;
    globalThis.__accettate = [];
    const MARCHI = ['ALFA', 'BETA', 'GAMMA'];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, tools, onDelta, onToolCall }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const chat = messages.some((m) => m.role === 'user' && String(m.content).startsWith('═══ CONTESTO DI ADESSO'));
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      const testi = messages.map((m) => String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
      const ingresso = Math.ceil((testi.reduce((s, t) => s + t.length, 0) + (tools ? JSON.stringify(tools).length : 0)) / 3.5);
      const uscita = Number(attempts[0].maxTokens) || 16384;
      if (!finestra) finestra = ingresso + uscita + Math.ceil(posto / 3.5);
      if (ingresso + uscita > finestra) {
        globalThis.__rifiutate++;
        const detto = misure
          ? `This endpoint's maximum context length is ${finestra} tokens. However, you requested about ${ingresso + uscita} tokens (${ingresso} of text input, ${uscita} of output). Please reduce the length of either one.`
          : 'Prompt is too long for this model.';
        const e = new Error(`OpenRouter 400: {"error":{"message":"${detto}","code":400}}`);
        e.status = 400;
        e.provider = 'openrouter';
        throw e;
      }
      const tutto = testi.join('\n');
      const k = globalThis.__accettate.push(tutto) - 1;
      const piano = piani[Math.min(k, piani.length - 1)];
      if (piano.finale) {
        const visti = MARCHI.filter((x) => tutto.includes(`MARCHIO_${x}`));
        const text = `${piano.finale} (visti: ${visti.join(', ') || 'nessuno'})`;
        try { onDelta && onDelta(text); } catch (_) {}
        return { ...base, text, toolCalls: [], finishReason: 'stop' };
      }
      const esiti = messages.filter((m) => m.role !== 'system').map((m) => String(m.content || '')).join('\n');
      const toolCalls = piano.strumenti.map((s, i) => {
        const args = { ...(s.args || {}) };
        if (s.urlDa) args.url = (esiti.match(new RegExp(s.urlDa, 'g')) || [])[s.indice || 0] || '';
        if (s.gruppoDa) { const m = new RegExp(s.gruppoDa).exec(esiti); args.url = m ? m[1] : ''; }
        return { id: `c${k}_${i}`, name: s.nome, arguments: JSON.stringify(args) };
      });
      for (const c of toolCalls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      return { ...base, text: '', toolCalls, finishReason: 'tool_calls' };
    };
  }, { finestra, posto, listino, misure, piani });
}

async function preparaPagine(app, testServer) {
  const urls = MARCHI.map((x) => testServer.html(paginaEnorme(x)));
  await app.evaluate((_e, results) => {
    globalThis.SN_WEB_SEARCH.search = async () => ({ ok: true, provider: 'stub', results });
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async (url, opts) => fetch(url, opts);
  }, urls.map((url, i) => ({ title: `Guida ${MARCHI[i]}`, url, snippet: 'Una guida lunghissima.' })));
  return urls;
}

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('tre turni con una pagina ciascuno: ogni risposta arriva con la sua pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await openTab(NEWTAB);
  const urls = await preparaPagine(app, testServer);
  const leggi = (url) => ({ strumenti: [{ nome: 'LEGGI_PAGINA', args: { url } }] });
  await modello(app, { finestra: FINESTRA, piani: [leggi(urls[0]), { finale: 'T1' }, leggi(urls[1]), { finale: 'T2' }, leggi(urls[2]), { finale: 'T3' }] });
  await chiedi(page, `leggimi ${urls[0]}`);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'T1 (' })).toBeVisible({ timeout: 40_000 });
  await chiedi(page, `e adesso ${urls[1]}`);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'T2 (' })).toBeVisible({ timeout: 40_000 });
  await chiedi(page, `e adesso ${urls[2]}`);
  const t3 = page.locator('.dash-bubble-filo', { hasText: 'T3 (' });
  await expect(t3).toBeVisible({ timeout: 40_000 });
  console.log('T1', await page.locator('.dash-bubble-filo', { hasText: 'T1 (' }).innerText());
  console.log('T2', await page.locator('.dash-bubble-filo', { hasText: 'T2 (' }).innerText());
  console.log('T3', await t3.innerText(), 'rifiutate', await app.evaluate(() => globalThis.__rifiutate));
  await expect(t3).toContainText('GAMMA');
});

for (const tema of ['light', 'dark']) {
  test(`aspetto dell'avviso (${tema})`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    const page = await openTab(NEWTAB);
    await page.emulateMedia({ colorScheme: tema });
    await preparaPagine(app, testServer);
    await modello(app, { finestra: FINESTRA, listino: true, piani: [
      { strumenti: [{ nome: 'CERCA_WEB', args: { query: 'guide' } }] },
      { strumenti: [0, 1, 2].map((indice) => ({ nome: 'LEGGI_PAGINA', urlDa: URL_RE, indice })) },
      { finale: 'Ecco il confronto delle guide.' },
    ] });
    await chiedi(page, 'confronta le tre guide che trovi');
    const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco il confronto' });
    await expect(bolla).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `tests/.shots/1596-giro3-avviso-${tema}.png` });
    console.log(await bolla.innerText());
  });
}
