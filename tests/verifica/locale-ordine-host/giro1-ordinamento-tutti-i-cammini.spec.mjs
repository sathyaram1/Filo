// Verifica: il criterio di ordinamento degli host scelto per un modello deve
// arrivare a OGNI cammino che chiama il router, e la lista di esclusione deve
// viaggiare identica qualunque sia l'ordinamento.
//
// Le richieste si intercettano nel processo main (il router vero non si chiama
// mai): si guarda il corpo JSON spedito a openrouter.ai.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://dashboard/dashboard.html';

// Sostituisce fetch nel main: registra le richieste verso il router e risponde
// con finte risposte valide per ogni endpoint.
async function intercetta(app) {
  await app.evaluate(async () => {
    if (globalThis.__ordineHostAttivo) { globalThis.__richieste.length = 0; return; }
    globalThis.__ordineHostAttivo = true;
    globalThis.__richieste = [];
    const vero = global.fetch;
    globalThis.__fetchVero = vero;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai')) return vero(url, init);
      let corpo = null;
      try { corpo = JSON.parse((init && init.body) || 'null'); } catch (_) { corpo = '[non JSON]'; }
      globalThis.__richieste.push({ url: u, corpo });

      const intestazioni = { 'content-type': 'application/json' };
      if (u.includes('/chat/completions')) {
        if (corpo && corpo.stream) {
          const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'
            + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1},"provider":"Baseten"}\n\n'
            + 'data: [DONE]\n\n';
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({
          id: 'gen-finta', provider: 'Baseten',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }), { status: 200, headers: intestazioni });
      }
      if (u.includes('/audio/speech')) {
        return new Response(new Uint8Array([1, 2, 3, 4]).buffer, {
          status: 200, headers: { 'content-type': 'audio/pcm;rate=24000' },
        });
      }
      if (u.includes('/audio/transcriptions')) {
        return new Response(JSON.stringify({ text: 'ciao', provider: 'Baseten', usage: { seconds: 1 } }),
          { status: 200, headers: intestazioni });
      }
      if (u.includes('/embeddings')) {
        const quanti = (corpo && Array.isArray(corpo.input)) ? corpo.input.length : 1;
        const dati = [];
        for (let i = 0; i < quanti; i++) dati.push({ index: i, embedding: new Array(8).fill(0.1) });
        return new Response(JSON.stringify({ data: dati, provider: 'Baseten', usage: { prompt_tokens: 1 } }),
          { status: 200, headers: intestazioni });
      }
      if (u.includes('/models')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: intestazioni });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200, headers: intestazioni });
    };
  });
}

// Registry con un ordinamento DIVERSO per ogni mestiere: così ogni richiesta
// intercettata si riconosce da sola, senza guardare l'endpoint.
async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const A = C.ACTIONS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta-ordine-host' },
      modelRegistry: {
        'prova-chat': { provider: 'openrouter', model: 'finto/chat', sort: 'throughput' },
        'prova-voce': { provider: 'openrouter', model: 'finto/voce', sort: 'latency' },
        'prova-detta': { provider: 'openrouter', model: 'finto/detta', sort: 'price' },
        'prova-indice': { provider: 'openrouter', model: 'finto/indice', sort: 'throughput' },
      },
      models: {
        [A.EXPLAIN]: 'prova-chat',
        [A.TTS]: 'prova-voce',
        [A.TRANSCRIBE_AUDIO]: 'prova-detta',
        [A.ARCHIVE_EMBED]: 'prova-indice',
      },
    });
  });
}

async function richieste(app) {
  return app.evaluate(async () => globalThis.__richieste.map((r) => ({
    url: r.url,
    modello: r.corpo && r.corpo.model,
    provider: r.corpo && r.corpo.provider,
  })));
}

async function listaAttesa(app) {
  return app.evaluate(async () => {
    const s = await globalThis.__filoHandlers.getEffectiveSettings();
    return globalThis.SN_CONST.providerIgnoreList(s.excludedProviders || []);
  });
}

test('l\'ordinamento scelto per il modello arriva a tutti e cinque i cammini, con la stessa lista di esclusione', async ({ app, openTab }) => {
  await preparaModelli(app);
  await intercetta(app);
  const attesa = await listaAttesa(app);
  expect(attesa.length, 'la politica sui fornitori deve avere una lista non vuota').toBeGreaterThan(0);

  const page = await openTab(PAGINA);
  await page.waitForTimeout(500);

  // 1. Chiamata normale (non in streaming).
  const normale = await page.evaluate(async () => window.filo.message({
    type: 'ai_request',
    action: 'explain',
    payload: { messages: [{ role: 'user', content: 'cammino normale ' + Date.now() }] },
  }));
  expect(normale && normale.ok, `chiamata normale fallita: ${JSON.stringify(normale)}`).toBeTruthy();

  // 2. Chat in streaming.
  const flusso = await page.evaluate(async () => new Promise((risolvi) => {
    window.filo.aiStream({
      action: 'explain',
      payload: { messages: [{ role: 'user', content: 'cammino in streaming ' + Date.now() }] },
      onDone: (d) => risolvi({ ok: true, d }),
      onError: (e) => risolvi({ ok: false, e: e && e.message }),
    });
    setTimeout(() => risolvi({ ok: false, e: 'scaduto' }), 15000);
  }));
  expect(flusso.ok, `streaming fallito: ${JSON.stringify(flusso)}`).toBe(true);

  // 3. Voce (lettura ad alta voce).
  const voce = await page.evaluate(async () => window.filo.message({
    type: 'tts_synth', text: 'ciao dalla verifica ' + Date.now(),
  }));
  expect(voce && voce.ok, `voce fallita: ${JSON.stringify(voce)}`).toBeTruthy();

  // 4. Dettatura.
  const dettatura = await page.evaluate(async () => window.filo.message({
    type: 'ai_request',
    action: 'transcribe_audio',
    payload: { audioBase64: 'UklGRiQAAABXQVZF', format: 'wav', lang: 'it' },
  }));
  expect(dettatura && dettatura.ok, `dettatura fallita: ${JSON.stringify(dettatura)}`).toBeTruthy();

  // 5. Indicizzazione (ricerca semantica nell'archivio schede).
  await page.evaluate(async () => window.filo.message({
    type: 'search_archived_tabs', query: 'qualcosa da indicizzare ' + Date.now(),
  }));

  const viste = await richieste(app);
  const perEndpoint = (frammento) => viste.filter((r) => r.url.includes(frammento));

  const casi = [
    ['/chat/completions', 'throughput', 2],
    ['/audio/speech', 'latency', 1],
    ['/audio/transcriptions', 'price', 1],
    ['/embeddings', 'throughput', 1],
  ];
  for (const [frammento, ordineAtteso, minime] of casi) {
    const trovate = perEndpoint(frammento);
    expect(trovate.length, `nessuna richiesta verso ${frammento}`).toBeGreaterThanOrEqual(minime);
    for (const r of trovate) {
      expect(r.provider, `${frammento}: nessun blocco fornitori nella richiesta`).toBeTruthy();
      expect(r.provider.sort, `${frammento}: ordinamento sbagliato`).toBe(ordineAtteso);
      expect(r.provider.ignore, `${frammento}: lista di esclusione diversa`).toEqual(attesa);
    }
  }
});

test('cambiando ordinamento al modello cambia solo l\'ordinamento: la lista di esclusione resta identica', async ({ app, openTab }) => {
  await preparaModelli(app);
  await intercetta(app);
  const attesa = await listaAttesa(app);
  const page = await openTab(PAGINA);
  await page.waitForTimeout(400);

  const viste = [];
  for (const ordine of ['auto', 'price', 'latency', 'throughput']) {
    await app.evaluate(async (_elettrone, ord) => {
      await globalThis.SN_STORAGE.updateSettings({
        modelRegistry: { 'prova-chat': { provider: 'openrouter', model: 'finto/chat', sort: ord } },
      });
      globalThis.__richieste.length = 0;
    }, ordine);
    const r = await page.evaluate(async (ord) => window.filo.message({
      type: 'ai_request',
      action: 'explain',
      payload: { messages: [{ role: 'user', content: `ordine ${ord} ${Date.now()}` }] },
    }), ordine);
    expect(r && r.ok, `chiamata con ordinamento ${ordine} fallita: ${JSON.stringify(r)}`).toBeTruthy();
    const q = await richieste(app);
    const chat = q.filter((x) => x.url.includes('/chat/completions'));
    expect(chat.length, `nessuna richiesta con ordinamento ${ordine}`).toBeGreaterThan(0);
    viste.push({ ordine, provider: chat[0].provider });
  }

  for (const v of viste) {
    expect(v.provider, `${v.ordine}: blocco fornitori assente`).toBeTruthy();
    expect(v.provider.ignore, `${v.ordine}: la lista di esclusione è cambiata`).toEqual(attesa);
    if (v.ordine === 'auto') {
      expect(v.provider.sort, 'con "automatico" non si deve imporre un ordine').toBeUndefined();
    } else {
      expect(v.provider.sort, `${v.ordine}: ordinamento non arrivato`).toBe(v.ordine);
    }
  }
});
