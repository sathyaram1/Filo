// L'ordinamento degli host (della voce, o la scelta generale per chi resta su «Automatico») arriva a ogni cammino
// che chiama il router: chat, streaming, voce, dettatura, indicizzazione. La lista di esclusione viaggia identica.
// Le richieste si intercettano nel main: il router vero non si chiama mai.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = 'filo://dashboard/dashboard.html';

async function intercetta(app) {
  await app.evaluate(async () => {
    if (globalThis.__ordineHostAttivo) { globalThis.__richieste.length = 0; return; }
    globalThis.__ordineHostAttivo = true;
    globalThis.__richieste = [];
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai')) return vero(url, init);
      let corpo = null;
      try { corpo = JSON.parse((init && init.body) || 'null'); } catch (_) { corpo = null; }
      globalThis.__richieste.push({ url: u, corpo });
      const json = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.includes('/chat/completions')) {
        if (corpo && corpo.stream) {
          const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'
            + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1},"provider":"Baseten"}\n\n'
            + 'data: [DONE]\n\n';
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return json({
          id: 'gen-finta', provider: 'Baseten',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
      }
      if (u.includes('/audio/speech')) {
        return new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200, headers: { 'content-type': 'audio/pcm;rate=24000' } });
      }
      if (u.includes('/audio/transcriptions')) return json({ text: 'ciao', provider: 'Baseten', usage: { seconds: 1 } });
      if (u.includes('/embeddings')) {
        const quanti = (corpo && Array.isArray(corpo.input)) ? corpo.input.length : 1;
        return json({ data: Array.from({ length: quanti }, (_, i) => ({ index: i, embedding: new Array(8).fill(0.1) })), provider: 'Baseten', usage: { prompt_tokens: 1 } });
      }
      // Voce e dettatura partono solo se tutti gli host del modello sono ammessi: qui ce n'è uno, indipendente.
      if (u.includes('/endpoints')) return json({ data: { endpoints: [{ provider_name: 'Baseten', tag: 'baseten' }] } });
      if (u.includes('/models')) return json({ data: [] });
      return json({ data: {} });
    };
  });
}

async function preparaModelli(app, ordini) {
  await app.evaluate(async (_e, o) => {
    const A = globalThis.SN_CONST.ACTIONS;
    const voce = (model, sort) => ({ provider: 'openrouter', model, ...(sort ? { sort } : {}) });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      ordineHost: '',
      apiKeys: { openrouter: 'sk-or-finta-ordine-host' },
      modelRegistry: {
        'prova-chat': voce('finto/chat', o.chat),
        'prova-voce': voce('finto/voce', o.voce),
        'prova-detta': voce('finto/detta', o.detta),
        'prova-indice': voce('finto/indice', o.indice),
      },
      models: {
        [A.EXPLAIN]: 'prova-chat',
        [A.TTS]: 'prova-voce',
        [A.TRANSCRIBE_AUDIO]: 'prova-detta',
        [A.ARCHIVE_EMBED]: 'prova-indice',
      },
    });
  }, ordini);
}

async function generaleA(app, valore) {
  await app.evaluate(async (_e, v) => {
    const D = globalThis.__filoDefaults;
    if (!globalThis.__getVeroOrdineHost) globalThis.__getVeroOrdineHost = D.get;
    D.get = (...a) => ({ ...globalThis.__getVeroOrdineHost(...a), providerSort: v });
  }, valore);
}

const listaAttesa = (app) => app.evaluate(async () => {
  const s = await globalThis.__filoHandlers.getEffectiveSettings();
  return globalThis.SN_CONST.providerIgnoreList(s.excludedProviders || []);
});

async function cinqueCammini(page) {
  const normale = await page.evaluate(async () => window.filo.message({
    type: 'ai_request', action: 'explain',
    payload: { messages: [{ role: 'user', content: `cammino normale ${Date.now()}` }] },
  }));
  expect(normale && normale.ok, `chiamata normale fallita: ${JSON.stringify(normale)}`).toBeTruthy();
  const flusso = await page.evaluate(async () => new Promise((risolvi) => {
    window.filo.aiStream({
      action: 'explain',
      payload: { messages: [{ role: 'user', content: `cammino in streaming ${Date.now()}` }] },
      onDone: (d) => risolvi({ ok: true, d }),
      onError: (e) => risolvi({ ok: false, e: e && e.message }),
    });
    setTimeout(() => risolvi({ ok: false, e: 'scaduto' }), 15000);
  }));
  expect(flusso.ok, `streaming fallito: ${JSON.stringify(flusso)}`).toBe(true);
  const voce = await page.evaluate(async () => window.filo.message({ type: 'tts_synth', text: `ciao ${Date.now()}` }));
  expect(voce && voce.ok, `voce fallita: ${JSON.stringify(voce)}`).toBeTruthy();
  const dettatura = await page.evaluate(async () => window.filo.message({
    type: 'ai_request', action: 'transcribe_audio',
    payload: { audioBase64: 'UklGRiQAAABXQVZF', format: 'wav', lang: 'it' },
  }));
  expect(dettatura && dettatura.ok, `dettatura fallita: ${JSON.stringify(dettatura)}`).toBeTruthy();
  await page.evaluate(async () => window.filo.message({ type: 'search_archived_tabs', query: `da indicizzare ${Date.now()}` }));
}

const viste = (app) => app.evaluate(async () => globalThis.__richieste.map((r) => ({ url: r.url, provider: r.corpo && r.corpo.provider })));

async function controlla(app, attesi, attesa) {
  const tutte = await viste(app);
  for (const [frammento, ordine] of attesi) {
    const trovate = tutte.filter((r) => r.url.includes(frammento));
    expect(trovate.length, `nessuna richiesta verso ${frammento}`).toBeGreaterThan(0);
    for (const r of trovate) {
      expect(r.provider, `${frammento}: nessun blocco fornitori nella richiesta`).toBeTruthy();
      expect(r.provider.sort, `${frammento}: ordinamento sbagliato`).toBe(ordine);
      expect(r.provider.ignore, `${frammento}: lista di esclusione diversa`).toEqual(attesa);
    }
  }
}

test('l\'ordinamento scelto per ogni modello arriva a tutti e cinque i cammini, con la stessa lista di esclusione', async ({ app, openTab }) => {
  await preparaModelli(app, { chat: 'throughput', voce: 'latency', detta: 'price', indice: 'throughput' });
  await intercetta(app);
  const attesa = await listaAttesa(app);
  expect(attesa.length, 'la politica sui fornitori deve avere una lista non vuota').toBeGreaterThan(0);
  const page = await openTab(PAGINA);
  await cinqueCammini(page);
  await controlla(app, [
    ['/chat/completions', 'throughput'], ['/audio/speech', 'latency'],
    ['/audio/transcriptions', 'price'], ['/embeddings', 'throughput'],
  ], attesa);
});

test('la scelta generale arriva a tutti e cinque i cammini per i modelli lasciati su «Automatico»', async ({ app, openTab }) => {
  await preparaModelli(app, {});
  await generaleA(app, 'latency');
  await intercetta(app);
  const attesa = await listaAttesa(app);
  const page = await openTab(PAGINA);
  await cinqueCammini(page);
  await controlla(app, [
    ['/chat/completions', 'latency'], ['/audio/speech', 'latency'],
    ['/audio/transcriptions', 'latency'], ['/embeddings', 'latency'],
  ], attesa);
});

test('cambiando ordinamento al modello cambia solo l\'ordinamento: la lista di esclusione resta identica', async ({ app, openTab }) => {
  await preparaModelli(app, {});
  await intercetta(app);
  const attesa = await listaAttesa(app);
  const page = await openTab(PAGINA);
  for (const ordine of ['auto', 'price', 'latency', 'throughput']) {
    await app.evaluate(async (_e, ord) => {
      await globalThis.SN_STORAGE.updateSettings({
        modelRegistry: { 'prova-chat': { provider: 'openrouter', model: 'finto/chat', sort: ord } },
      });
      globalThis.__richieste.length = 0;
    }, ordine);
    const r = await page.evaluate(async (ord) => window.filo.message({
      type: 'ai_request', action: 'explain',
      payload: { messages: [{ role: 'user', content: `ordine ${ord} ${Date.now()}` }] },
    }), ordine);
    expect(r && r.ok, `chiamata con ordinamento ${ordine} fallita: ${JSON.stringify(r)}`).toBeTruthy();
    const chat = (await viste(app)).filter((x) => x.url.includes('/chat/completions'));
    expect(chat.length, `nessuna richiesta con ordinamento ${ordine}`).toBeGreaterThan(0);
    expect(chat[0].provider.ignore, `${ordine}: la lista di esclusione è cambiata`).toEqual(attesa);
    if (ordine === 'auto') expect(chat[0].provider.sort, 'con «Automatico» non si impone un ordine').toBeUndefined();
    else expect(chat[0].provider.sort, `${ordine}: ordinamento non arrivato`).toBe(ordine);
  }
});
