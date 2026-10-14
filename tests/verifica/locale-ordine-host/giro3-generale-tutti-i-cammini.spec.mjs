// Il giro scorso ha provato l'ordinamento scelto SUL MODELLO su tutti e cinque
// i cammini, e la scelta generale su un cammino solo (la chiamata normale).
// Qui si prova la scelta generale su tutti e cinque: un modello lasciato su
// «Automatico» deve seguirla ovunque, non solo nella chat.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://dashboard/dashboard.html';

async function intercetta(app) {
  await app.evaluate(async () => {
    if (globalThis.__generaleCamminiAttivo) { globalThis.__richieste.length = 0; return; }
    globalThis.__generaleCamminiAttivo = true;
    globalThis.__richieste = [];
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai')) return vero(url, init);
      let corpo = null;
      try { corpo = JSON.parse((init && init.body) || 'null'); } catch (_) { corpo = null; }
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

async function generaleA(app, valore) {
  await app.evaluate(async (_e, v) => {
    const D = globalThis.__filoDefaults;
    if (!globalThis.__getVeroGen3) globalThis.__getVeroGen3 = D.get;
    D.get = (...a) => ({ ...globalThis.__getVeroGen3(...a), providerSort: v });
  }, valore);
}

// Nessun modello sceglie: tutti restano su «Automatico», quindi tutti devono
// seguire la scelta generale.
async function preparaModelli(app) {
  await app.evaluate(async () => {
    const A = globalThis.SN_CONST.ACTIONS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta-ordine-host' },
      modelRegistry: {
        'auto-chat': { provider: 'openrouter', model: 'finto/chat' },
        'auto-voce': { provider: 'openrouter', model: 'finto/voce' },
        'auto-detta': { provider: 'openrouter', model: 'finto/detta' },
        'auto-indice': { provider: 'openrouter', model: 'finto/indice' },
      },
      models: {
        [A.EXPLAIN]: 'auto-chat',
        [A.TTS]: 'auto-voce',
        [A.TRANSCRIBE_AUDIO]: 'auto-detta',
        [A.ARCHIVE_EMBED]: 'auto-indice',
      },
    });
  });
}

async function listaAttesa(app) {
  return app.evaluate(async () => {
    const s = await globalThis.__filoHandlers.getEffectiveSettings();
    return globalThis.SN_CONST.providerIgnoreList(s.excludedProviders || []);
  });
}

test('la scelta generale arriva a tutti e cinque i cammini, con la stessa lista di esclusione', async ({ app, openTab }) => {
  await preparaModelli(app);
  await generaleA(app, 'latency');
  await intercetta(app);
  const attesa = await listaAttesa(app);
  expect(attesa.length, 'la politica sui fornitori deve avere una lista non vuota').toBeGreaterThan(0);

  const page = await openTab(PAGINA);
  await page.waitForTimeout(500);

  const normale = await page.evaluate(async () => window.filo.message({
    type: 'ai_request',
    action: 'explain',
    payload: { messages: [{ role: 'user', content: 'generale normale ' + Date.now() }] },
  }));
  expect(normale && normale.ok, `chiamata normale fallita: ${JSON.stringify(normale)}`).toBeTruthy();

  const flusso = await page.evaluate(async () => new Promise((risolvi) => {
    window.filo.aiStream({
      action: 'explain',
      payload: { messages: [{ role: 'user', content: 'generale in streaming ' + Date.now() }] },
      onDone: (d) => risolvi({ ok: true, d }),
      onError: (e) => risolvi({ ok: false, e: e && e.message }),
    });
    setTimeout(() => risolvi({ ok: false, e: 'scaduto' }), 15000);
  }));
  expect(flusso.ok, `streaming fallito: ${JSON.stringify(flusso)}`).toBe(true);

  const voce = await page.evaluate(async () => window.filo.message({
    type: 'tts_synth', text: 'generale a voce ' + Date.now(),
  }));
  expect(voce && voce.ok, `voce fallita: ${JSON.stringify(voce)}`).toBeTruthy();

  const dettatura = await page.evaluate(async () => window.filo.message({
    type: 'ai_request',
    action: 'transcribe_audio',
    payload: { audioBase64: 'UklGRiQAAABXQVZF', format: 'wav', lang: 'it' },
  }));
  expect(dettatura && dettatura.ok, `dettatura fallita: ${JSON.stringify(dettatura)}`).toBeTruthy();

  await page.evaluate(async () => window.filo.message({
    type: 'search_archived_tabs', query: 'generale da indicizzare ' + Date.now(),
  }));

  const viste = await app.evaluate(async () => globalThis.__richieste.map((r) => ({
    url: r.url,
    provider: r.corpo && r.corpo.provider,
  })));

  for (const frammento of ['/chat/completions', '/audio/speech', '/audio/transcriptions', '/embeddings']) {
    const trovate = viste.filter((r) => r.url.includes(frammento));
    expect(trovate.length, `nessuna richiesta verso ${frammento}`).toBeGreaterThan(0);
    for (const r of trovate) {
      expect(r.provider, `${frammento}: nessun blocco fornitori nella richiesta`).toBeTruthy();
      expect(r.provider.sort,
        `${frammento}: la scelta generale non arriva su questo cammino`).toBe('latency');
      expect(r.provider.ignore, `${frammento}: lista di esclusione diversa`).toEqual(attesa);
    }
  }
});
