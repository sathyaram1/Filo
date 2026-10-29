// Esplorazione del giro 6 su #1596: pezzi della stessa pagina, due turni di fila, ricarica, aspetto.
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const URL_RE = 'http://127\\.0\\.0\\.1:\\d+/\\d+';
const MARCHI = ['ALFA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON', 'ZETA'];

function paginaEnorme(nome) {
  const riga = `Paragrafo della pagina ${nome} con dati, prezzi e orari da leggere con calma prima di rispondere. `;
  const corpo = Array.from({ length: 2200 }, (_, i) => `<p>${i}. ${i === 400 ? `SECONDO_${nome} ` : ''}${i === 800 ? `TERZO_${nome} ` : ''}${riga}</p>`).join('\n');
  return `<!doctype html><html lang="it"><head><title>Guida ${nome}</title></head><body><main><article>
<h1>Guida ${nome}</h1><p>MARCHIO_${nome}: il dato che serve sta qui.</p>
${corpo}
</article></main></body></html>`;
}

async function modello(app, { finestra = 0, posto = 0, piani }) {
  await app.evaluate(async (_e, { finestra, posto, piani, MARCHI }) => {
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
    globalThis.__accettate = [];
    let k = -1;
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
        const detto = `This endpoint's maximum context length is ${finestra} tokens. However, you requested about ${ingresso + uscita} tokens (${ingresso} of text input, ${uscita} of output). Please reduce the length of either one.`;
        const e = new Error(`OpenRouter 400: {"error":{"message":"${detto}","code":400}}`);
        e.status = 400;
        e.provider = 'openrouter';
        throw e;
      }
      const tutto = testi.join('\n');
      globalThis.__accettate.push(tutto);
      k++;
      const piano = piani[Math.min(k, piani.length - 1)];
      if (piano.finale) {
        const visti = MARCHI.flatMap((x) => [`MARCHIO_${x}`, `SECONDO_${x}`, `TERZO_${x}`]).filter((m) => tutto.includes(m));
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
  }, { finestra, posto, piani, MARCHI });
}

async function preparaPagine(app, testServer, nomi) {
  const urls = nomi.map((x) => testServer.html(paginaEnorme(x)));
  await app.evaluate((_e, results) => {
    globalThis.SN_WEB_SEARCH.search = async ({ query } = {}) => ({ ok: true, provider: 'stub', results: results.filter((r) => !query || r.gruppo === query) });
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async (url, opts) => fetch(url, opts);
  }, urls.map((url, i) => ({ title: `Guida ${nomi[i]}`, url, snippet: 'Una guida lunghissima.', gruppo: i < 3 ? 'uno' : 'due' })));
  return urls;
}

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('pezzi della stessa pagina letti uno dopo l\'altro: la risposta arriva e l\'avviso conta bene', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const page = await openTab(NEWTAB);
  const [url] = await preparaPagine(app, testServer, ['ALFA']);
  await modello(app, {
    posto: 45000,
    piani: [
      { strumenti: [{ nome: 'LEGGI_PAGINA', args: { url } }] },
      { strumenti: [{ nome: 'LEGGI_PAGINA', args: { url, da: 30000 } }] },
      { strumenti: [{ nome: 'LEGGI_PAGINA', args: { url, da: 60000 } }] },
      { finale: 'PEZZI' },
    ],
  });
  await chiedi(page, `leggi tutta ${url}`);
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'PEZZI' });
  await expect(bolla).toBeVisible({ timeout: 60_000 });
  console.log('PEZZI:', await bolla.innerText());
  console.log('rifiutate', await app.evaluate(() => globalThis.__rifiutate));
  const acc = await app.evaluate(() => globalThis.__accettate);
  for (const t of acc) {
    const pezzi = [...t.matchAll(/\[(Pagina web[^\]]{0,300}|Letto fino[^\]]{0,300})\]/g)].map((m) => m[0].slice(0, 200));
    console.log('RICHIESTA len', t.length, JSON.stringify(pezzi, null, 1));
  }
});

test('due turni di fila con tre pagine ciascuno', async ({ app, openTab, testServer }) => {
  test.setTimeout(200_000);
  const page = await openTab(NEWTAB);
  const urls = await preparaPagine(app, testServer, MARCHI);
  const tre = (q, from) => [
    { strumenti: [{ nome: 'CERCA_WEB', args: { query: q } }] },
    { strumenti: [0, 1, 2].map((i) => ({ nome: 'LEGGI_PAGINA', args: { url: urls[i + from] } })) },
  ];
  await modello(app, { finestra: 72000, piani: [...tre('uno', 0), { finale: 'PRIMO' }, ...tre('due', 3), { finale: 'SECONDO' }] });
  await chiedi(page, 'confronta le tre guide che trovi');
  const b1 = page.locator('.dash-bubble-filo', { hasText: 'PRIMO' });
  await expect(b1).toBeVisible({ timeout: 60_000 });
  console.log('PRIMO:', await b1.innerText());
  await chiedi(page, 'ora cerca le altre tre guide e confrontale');
  const b2 = page.locator('.dash-bubble-filo', { hasText: 'SECONDO' });
  await expect(b2).toBeVisible({ timeout: 90_000 });
  console.log('SECONDO:', await b2.innerText());
  console.log('rifiutate', await app.evaluate(() => globalThis.__rifiutate));
  await b2.screenshot({ path: 'tests/.shots/1596-g6-chiaro.png' });
  await app.evaluate((_e) => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
  await page.waitForTimeout(800);
  await b2.screenshot({ path: 'tests/.shots/1596-g6-scuro.png' });
  await page.reload();
  await page.waitForTimeout(3000);
  console.log('DOPO RICARICA:', (await page.locator('.dash-bubble-filo').allInnerTexts()).join('\n---\n'));
});
