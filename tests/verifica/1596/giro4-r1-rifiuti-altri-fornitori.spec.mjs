// #1596 giro 4 — il rifiuto per finestra piena scritto da altri fornitori (Moonshot, Google, Together, xAI) dietro
// OpenRouter: le pagine del turno si devono accorciare come con le forme già note, e la risposta arrivare con l'avviso.
// Più la porta del giro 1 (tre pagine, posto per una e mezza: la seconda resta almeno in parte).

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

// `formato`: chi scrive il rifiuto. Il corpo passa dal lettore vero degli errori di OpenRouter.
async function modello(app, { posto, piani, formato }) {
  await app.evaluate(async (_e, { posto, piani, formato }) => {
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
      if (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(url)) return new Response('giù', { status: 503 });
      return vero(input, init);
    };
    globalThis.__rifiutate = 0;
    let finestra = 0;
    const MARCHI = ['ALFA', 'BETA', 'GAMMA'];
    const avvolgi = (raw, prov) => JSON.stringify({ error: { message: 'Provider returned error', code: 400, metadata: { raw, provider_name: prov } } });
    const corpi = {
      openrouter: (i, u, f) => JSON.stringify({ error: { message: `This endpoint's maximum context length is ${f} tokens. However, you requested about ${i + u} tokens (${i} of text input, ${u} in the output). Please reduce the length of either one.`, code: 400 } }),
      moonshot: (_i, _u, f) => avvolgi(JSON.stringify({ error: { message: `Invalid request: Your request exceeded model token limit: ${f}`, type: 'invalid_request_error' } }), 'Moonshot AI'),
      google: (i, _u, f) => avvolgi(JSON.stringify({ error: { code: 400, message: `The input token count (${i}) exceeds the maximum number of tokens allowed (${f}).`, status: 'INVALID_ARGUMENT' } }), 'Google AI Studio'),
      together: (i, u, f) => avvolgi(JSON.stringify({ message: `Input validation error: \`inputs\` tokens + \`max_new_tokens\` must be <= ${f}. Given: ${i} \`inputs\` tokens and ${u} \`max_new_tokens\``, type: 'invalid_request_error' }), 'Together'),
      xai: (i, _u, f) => avvolgi(JSON.stringify({ code: 'Client specified an invalid argument', error: `This model's maximum prompt length is ${f} but the request contains ${i} tokens.` }), 'xAI'),
    };
    globalThis.__accettate = [];
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
        const body = corpi[formato](ingresso, uscita, finestra);
        throw await globalThis.SN_PROVIDER_OPENROUTER.httpError(new Response(body, { status: 400 }), { tools: !!tools, maxTokens: uscita, model: attempts[0].model });
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
  }, { posto, piani, formato });
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

const RICERCA_E_TRE_PAGINE = [
  { strumenti: [{ nome: 'CERCA_WEB', args: { query: 'guide' } }] },
  { strumenti: [0, 1, 2].map((indice) => ({ nome: 'LEGGI_PAGINA', urlDa: URL_RE, indice })) },
  { finale: 'RISPOSTA PRONTA' },
];

async function treGuide(app, page, testServer, formato, posto) {
  await preparaPagine(app, testServer);
  await modello(app, { posto, piani: RICERCA_E_TRE_PAGINE, formato });
  await page.locator('#input').fill('confronta le tre guide che trovi');
  await page.locator('#sendBtn').click();
  return page.locator('.dash-bubble-filo').last();
}

test('tre pagine e posto per una e mezza: la prima intera e della seconda almeno l\'inizio', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await treGuide(app, page, testServer, 'openrouter', 50000);
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA PRONTA' });
  await expect(bolla).toBeVisible({ timeout: 40_000 });
  await expect(bolla).toContainText('visti: ALFA, BETA');
  await expect(bolla).toContainText('Il modello non riusciva a leggere tutto insieme');
});

for (const formato of ['moonshot', 'google', 'together', 'xai']) {
  test(`r1 rifiuto per finestra scritto da ${formato}: le pagine si accorciano e la risposta arriva con l'avviso`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    const page = await openTab(NEWTAB);
    await treGuide(app, page, testServer, formato, 40000);
    const bolla = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA PRONTA' });
    await expect(bolla).toBeVisible({ timeout: 40_000 });
    await expect(bolla).toContainText('visti: ALFA');
    await expect(bolla).toContainText('Il modello non riusciva a leggere tutto insieme');
  });
}
