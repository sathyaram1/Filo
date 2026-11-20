// Verifica #2272: foto finte scaricate dal main e un modello finto che chiama gli strumenti e poi risponde.

export const NEWTAB = 'filo://newtab/';

export async function preparaImmagini(app, quante, { w = 320, h = 220 } = {}) {
  await app.evaluate(({ nativeImage }, { quante, w, h }) => {
    const png = (k) => {
      const buf = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) { buf[i * 4] = (40 * k) % 255; buf[i * 4 + 1] = 120; buf[i * 4 + 2] = 200 - 20 * k; buf[i * 4 + 3] = 255; }
      return nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG();
    };
    const C = globalThis.__filoImmaginiDelleRisposte;
    C._dip.tavily = async () => [];
    C._dip.commons = async () => Array.from({ length: quante }, (_, k) => ({
      immagine: `https://upload.wikimedia.org/antilope-${k}.png`, titolo: `Antilope ${k + 1}`, sito: 'commons.wikimedia.org',
      pagina: `https://commons.wikimedia.org/wiki/File:Antilope_${k + 1}.png`,
    }));
    C._dip.scarica = async (url) => {
      const k = Number((/antilope-(\d+)/.exec(url) || [])[1]);
      return new Response(png(k), { status: 200 });
    };
  }, { quante, w, h });
}

// `copione`: un passo per chiamata al modello; { strumento } chiama web(...), { testo } risponde. Nel testo $ID0, $ID1…
// sono gli id d'immagine nell'ordine in cui il modello li vede nella conversazione.
export async function stubModello(app, copione) {
  await app.evaluate(async (_e, copione) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__passo = 0;
    globalThis.__visti = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({ text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__passo++;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const visto = messages.filter((m) => m.role !== 'system').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      globalThis.__visti.push(visto);
      const passo = copione[Math.min(n, copione.length - 1)];
      if (passo.strumento) {
        const c = { id: `c${n}`, name: 'web', arguments: JSON.stringify(passo.strumento) };
        try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [c], finishReason: 'tool_calls' };
      }
      const ids = [...new Set(visto.match(/\b[ig]\d+\b(?=:|,|\))/g) || [])];
      let text = passo.testo;
      ids.forEach((id, k) => { text = text.split(`$ID${k}`).join(id); });
      for (let i = 0; i < text.length; i += 9) { try { onDelta && onDelta(text.slice(i, i + 9)); } catch (_) {} }
      return { ...base, text, toolCalls: [], finishReason: 'stop' };
    };
  }, copione);
}

// Dopo stubModello con la ricerca al primo passo: la risposta cita le prime due foto e poi scrive piano, a lungo.
export async function rispostaLenta(app) {
  await app.evaluate(() => {
    const prima = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => {
      if (globalThis.__passo === 0) return prima(o);
      globalThis.__passo++;
      const visto = o.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const ids = [...new Set(visto.match(/\b[ig]\d+\b(?=:|,|\))/g) || [])];
      const text = `Ecco le antilopi che ho trovato per te.\n\n[[immagini: ${ids[0]}, ${ids[1]}]]\n\n` + 'Testo lungo che continua a arrivare piano piano. '.repeat(60);
      for (let i = 0; i < text.length; i += 4) {
        if (o.signal && o.signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
        if (o.onDelta) o.onDelta(text.slice(i, i + 4));
        await new Promise((r) => setTimeout(r, 25));
      }
      return { model: o.attempts[0].model, provider: o.attempts[0].provider, usage: {}, reasoningDetails: [], text, toolCalls: [], finishReason: 'stop' };
    };
  });
}

export async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}
