// Esplorazione #2276: com'era rotta la prova con la finestra fissa, e il cammino col listino a posto stretto.
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const URL_RE = 'http://127\\.0\\.0\\.1:\\d+/\\d+';
const MARCHI = ['ALFA', 'BETA', 'GAMMA'];

function paginaEnorme(nome) {
  const riga = `Paragrafo della pagina ${nome} con dati, prezzi e orari da leggere con calma prima di rispondere. `;
  const corpo = Array.from({ length: 2200 }, (_, i) => `<p>${i}. ${riga}</p>`).join('\n');
  return `<!doctype html><html lang="it"><head><title>Guida ${nome}</title></head><body><main><article>
<h1>Guida ${nome}</h1><p>MARCHIO_${nome}: il dato che serve sta qui.</p>
${corpo}
</article></main></body></html>`;
}

async function modello(app, { finestra = 0, posto = 0, listino = false, piani }) {
  await app.evaluate(async (_e, { finestra, posto, listino, piani }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      lunghezzaRisposte: { conversazioni: 16384 },
    });
    const vero = globalThis.__fetchVeroListino || globalThis.fetch;
    globalThis.__fetchVeroListino = vero;
    globalThis.__finestraFissa = finestra;
    globalThis.fetch = async (input, init) => {
      const url = String((input && input.url) || input);
      if (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(url)) {
        if (!listino) return new Response('giù', { status: 503 });
        globalThis.__letture = (globalThis.__letture || 0) + 1;
        const data = url.includes('output_modalities') ? [] : [{ id: 'deepseek/deepseek-v4-flash', context_length: finestra, pricing: { prompt: '0.0000001', completion: '0.0000002' } }];
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return vero(input, init);
    };
    globalThis.__rifiutate = 0;
    globalThis.__accettate = [];
    globalThis.__ingressi = [];
    const MARCHI = ['ALFA', 'BETA', 'GAMMA'];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, tools, onDelta, onToolCall }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const chat = !!messages[0] && messages[0].role === 'system' && String(messages[0].content || '').startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic());
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      const testi = messages.map((m) => String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
      const ingresso = Math.ceil((testi.reduce((s, t) => s + t.length, 0) + (tools ? JSON.stringify(tools).length : 0)) / 3.5);
      const uscita = Number(attempts[0].maxTokens) || 16384;
      globalThis.__ingressi.push([ingresso, uscita, tools ? JSON.stringify(tools).length : 0]);
      if (!finestra) finestra = ingresso + uscita + Math.ceil(posto / 3.5);
      if (ingresso + uscita > finestra) {
        globalThis.__rifiutate++;
        const detto = `This endpoint's maximum context length is ${finestra} tokens. However, you requested about ${ingresso + uscita} tokens (${ingresso} of text input, ${uscita} of output). Please reduce the length of either one.`;
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
        return { id: `c${k}_${i}`, name: s.nome, arguments: JSON.stringify(args) };
      });
      for (const c of toolCalls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      return { ...base, text: '', toolCalls, finishReason: 'tool_calls' };
    };
  }, { finestra, posto, listino, piani });
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

const TRE = [
  { strumenti: [{ nome: 'CERCA_WEB', args: { query: 'guide' } }] },
  { strumenti: [0, 1, 2].map((indice) => ({ nome: 'LEGGI_PAGINA', urlDa: URL_RE, indice })) },
  { finale: 'RISPOSTA PRONTA' },
];

for (const caso of [
  { nome: 'finestra fissa 72000 col listino (la prova di main)', finestra: 72000, listino: true },
  { nome: 'finestra fissa 72000 senza listino', finestra: 72000, listino: false },
  { nome: 'listino, posto 30000', posto: 30000, listino: true },
  { nome: 'listino, posto 12000', posto: 12000, listino: true },
  { nome: 'senza listino, posto 12000', posto: 12000, listino: false },
]) {
  test(`esplora: ${caso.nome}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    const page = await openTab(NEWTAB);
    await preparaPagine(app, testServer);
    await modello(app, { ...caso, piani: TRE });
    await page.locator('#input').fill('confronta le tre guide che trovi');
    await page.locator('#sendBtn').click();
    const bolla = page.locator('.dash-bubble-filo').last();
    await expect(page.locator('.dash-bubble-filo', { hasText: /RISPOSTA PRONTA|meno pagine|errore/i })).toBeVisible({ timeout: 60_000 }).catch(() => {});
    const testo = await bolla.innerText().catch(() => '');
    const info = await app.evaluate(() => ({ r: globalThis.__rifiutate, ing: globalThis.__ingressi, letture: globalThis.__letture || 0 }));
    console.log(`[${caso.nome}]`, JSON.stringify(info), '\n', testo.slice(0, 600));
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA PRONTA' })).toContainText('visti: ALFA');
  });
}
