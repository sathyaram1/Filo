// Aiuto della verifica #1596: un modello finto che rifiuta come OpenRouter le richieste oltre la sua finestra
// (la prima chiamata più un margine, col tetto della risposta nel chiesto), e tre pagine da 60.000 token.

export const NEWTAB = 'filo://newtab/';
const URL_RE = 'http://127\\.0\\.0\\.1:\\d+/\\d+';

// `rifiuto`: 'numeri' (messaggio con le misure), 'nudo' (senza numeri), 'sempre' (rifiuta tutto oltre la prima chiamata).
export async function stub(app, piani, { margine = 45000, rifiuto = 'numeri' } = {}) {
  await app.evaluate(async (_e, { piani, margine, rifiuto, URL_RE }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async (url, opts) => fetch(url, opts);
    globalThis.__g = { chiamate: [], rifiuti: 0, base: null, piano: 0 };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, tools, onDelta, onToolCall }) => {
      const g = globalThis.__g;
      const car = JSON.stringify(messages).length + JSON.stringify(tools || []).length;
      if (g.base == null) g.base = car;
      // Come OpenRouter: nel chiesto entra anche il tetto della risposta.
      const out = Math.max(0, Number(attempts[0].maxTokens ?? attempts[0].max_tokens ?? 0) || 0);
      g.out = out;
      g.chiamate.push({ car, messages: JSON.parse(JSON.stringify(messages)) });
      const limite = g.base + margine;
      if (g.chiamate.length > 1 && (rifiuto === 'sempre' || car > limite)) {
        g.rifiuti++;
        const max = Math.floor(limite / 3.5) + out;
        const chiesti = Math.ceil(car / 3.5);
        const msg = rifiuto === 'nudo'
          ? 'OpenRouter 400: Input is too long for requested model.'
          : `OpenRouter 400: This endpoint's maximum context length is ${max} tokens. However, you requested about ${chiesti + out} tokens (${chiesti} of text input, ${out} in the output). Please reduce the length of either one, or use the "middle-out" transform to compress your prompt automatically.`;
        const e = new Error(msg);
        e.status = 400;
        e.provider = 'openrouter';
        throw e;
      }
      const piano = piani[Math.min(g.piano, piani.length - 1)];
      g.piano++;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const esiti = messages.filter((m) => m.role === 'tool').map((m) => String(m.content || '')).join('\n');
      if (piano.finale) {
        const viste = [...new Set(esiti.match(/MARCA_[A-Z]_DENTRO/g) || [])].sort();
        const text = `${piano.finale} viste=${viste.join(',') || 'nessuna'}`;
        try { onDelta && onDelta(text); } catch (_) {}
        return { ...base, text, toolCalls: [], finishReason: 'stop' };
      }
      const toolCalls = piano.strumenti.map((s, i) => {
        const args = { ...(s.args || {}) };
        if (s.urlDa != null) {
          const tutti = esiti.match(new RegExp(URL_RE, 'g')) || [];
          args.url = [...new Set(tutti)][s.urlDa] || '';
        }
        if (s.rileggiFuori) {
          // L'indirizzo di una pagina lasciata fuori, come lo vede il modello nella sua cronologia.
          const tutto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
          const k = tutto.indexOf('lasciata fuori');
          const m = k >= 0 ? new RegExp(URL_RE).exec(tutto.slice(k)) : null;
          args.url = m ? m[0] : '';
          globalThis.__g.riletta = args.url;
        }
        return { id: `c${g.piano}_${i}`, name: s.nome, arguments: JSON.stringify(args) };
      });
      for (const c of toolCalls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      return { ...base, text: '', toolCalls, finishReason: 'tool_calls' };
    };
  }, { piani, margine, rifiuto, URL_RE });
}

// Una pagina lunga circa 60.000 token: il segno sta all'inizio, così basta che ne resti un pezzo per vederlo.
export function paginaGrande(lettera) {
  const frase = `Paragrafo della guida ${lettera} sui sentieri delle Dolomiti, con quote, tempi di percorrenza e rifugi aperti in stagione. `;
  return `<!doctype html><html><head><title>Guida ${lettera}</title></head><body><main><h1>Guida ${lettera}</h1>`
    + `<p>MARCA_${lettera}_DENTRO</p>${Array.from({ length: 1800 }, () => `<p>${frase}</p>`).join('')}</main></body></html>`;
}

export async function tre(app, testServer) {
  const urls = ['A', 'B', 'C'].map((l) => testServer.html(paginaGrande(l)));
  await app.evaluate((_e, urls) => {
    globalThis.SN_WEB_SEARCH.search = async () => ({ ok: true, provider: 'stub', results: urls.map((url, i) => ({ title: `Guida ${'ABC'[i]}`, url, snippet: 'sentieri' })) });
  }, urls);
  return urls;
}

export const PIANO_TRE = [
  { strumenti: [{ nome: 'CERCA_WEB', args: { query: 'sentieri dolomiti' } }] },
  { strumenti: [0, 1, 2].map((k) => ({ nome: 'LEGGI_PAGINA', urlDa: k })) },
  { finale: 'RISPOSTA_UNO' },
];

export async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}
