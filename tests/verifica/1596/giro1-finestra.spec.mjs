// Verifica #1596 giro 1: pagine lette nello stesso turno oltre la finestra del modello. Il modello finto rifiuta
// come OpenRouter le richieste oltre la sua finestra (misurata sulla prima chiamata, più un margine).
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const URL_RE = 'http://127\\.0\\.0\\.1:\\d+/\\d+';

// `rifiuto`: 'numeri' (messaggio con le misure), 'nudo' (senza numeri), 'sempre' (rifiuta tutto oltre la prima chiamata).
async function stub(app, piani, { margine = 45000, rifiuto = 'numeri' } = {}) {
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
      g.chiamate.push({ car, messages: JSON.parse(JSON.stringify(messages)) });
      const limite = g.base + margine;
      if (g.chiamate.length > 1 && (rifiuto === 'sempre' || car > limite)) {
        g.rifiuti++;
        const max = Math.floor(limite / 3.5);
        const msg = rifiuto === 'nudo'
          ? 'OpenRouter 400: Input is too long for requested model.'
          : `OpenRouter 400: This endpoint's maximum context length is ${max} tokens. However, you requested about ${Math.ceil(car / 3.5)} tokens (${Math.ceil(car / 3.5) - 4000} of text input, 4000 in the output). Please reduce the length of either one, or use the "middle-out" transform to compress your prompt automatically.`;
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
function paginaGrande(lettera) {
  const frase = `Paragrafo della guida ${lettera} sui sentieri delle Dolomiti, con quote, tempi di percorrenza e rifugi aperti in stagione. `;
  return `<!doctype html><html><head><title>Guida ${lettera}</title></head><body><main><h1>Guida ${lettera}</h1>`
    + `<p>MARCA_${lettera}_DENTRO</p>${Array.from({ length: 1800 }, () => `<p>${frase}</p>`).join('')}</main></body></html>`;
}

async function tre(app, testServer) {
  const urls = ['A', 'B', 'C'].map((l) => testServer.html(paginaGrande(l)));
  await app.evaluate((_e, urls) => {
    globalThis.SN_WEB_SEARCH.search = async () => ({ ok: true, provider: 'stub', results: urls.map((url, i) => ({ title: `Guida ${'ABC'[i]}`, url, snippet: 'sentieri' })) });
  }, urls);
  return urls;
}

const PIANO_TRE = [
  { strumenti: [{ nome: 'CERCA_WEB', args: { query: 'sentieri dolomiti' } }] },
  { strumenti: [0, 1, 2].map((k) => ({ nome: 'LEGGI_PAGINA', urlDa: k })) },
  { finale: 'RISPOSTA_UNO' },
];

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('tre pagine da 60.000 token con un modello a finestra piccola: arriva la risposta, con l\'avviso delle pagine tagliate, e la tagliata si rilegge chiedendolo', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await tre(app, testServer);
  await stub(app, [...PIANO_TRE, { strumenti: [{ nome: 'LEGGI_PAGINA', rileggiFuori: true }] }, { finale: 'RISPOSTA_DUE' }]);

  await chiedi(page, 'cerca i sentieri delle dolomiti e leggimi le guide');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_UNO' });
  await expect(bolla).toBeVisible({ timeout: 40_000 });
  await expect(bolla).toContainText('ho lasciato fuori');
  await expect(bolla).toContainText(/chiedimi di rileggerl/);
  await page.screenshot({ path: 'tests/.shots/verifica-1596-avviso.png' });
  const g1 = await app.evaluate(() => ({ rifiuti: globalThis.__g.rifiuti, n: globalThis.__g.chiamate.length }));
  console.log('MISURE3', JSON.stringify(await app.evaluate(() => ({ base: globalThis.__g.base, car: globalThis.__g.chiamate.map((c) => c.car) }))));
  expect(g1.rifiuti).toBeGreaterThan(0);
  const testo1 = await bolla.innerText();
  const viste1 = (/viste=([^\s]+)/.exec(testo1) || [])[1] || '';
  expect(viste1.split(',').length, `pagine viste al primo turno: ${viste1}`).toBeLessThan(3);

  await chiedi(page, 'rileggi la pagina che hai lasciato fuori');
  const bolla2 = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_DUE' });
  await expect(bolla2).toBeVisible({ timeout: 40_000 });
  const riletta = await app.evaluate(() => globalThis.__g.riletta);
  expect(riletta).toMatch(/^http:\/\/127\.0\.0\.1/);
  const testo2 = await bolla2.innerText();
  const viste2 = (/viste=([^\s]+)/.exec(testo2) || [])[1] || '';
  const nuove = viste2.split(',').filter((v) => !viste1.split(',').includes(v));
  expect(nuove.length, `al secondo turno viste ${viste2}, al primo ${viste1}`).toBeGreaterThan(0);
});

test('il rifiuto senza misure (solo «input troppo lungo»): la risposta arriva lo stesso, con l\'avviso', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await tre(app, testServer);
  await stub(app, PIANO_TRE, { rifiuto: 'nudo' });
  await chiedi(page, 'cerca i sentieri delle dolomiti e leggimi le guide');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_UNO' });
  await expect(bolla).toBeVisible({ timeout: 40_000 });
  await expect(bolla).toContainText(/ho lasciato fuori|ho tenuto solo l'inizio/);
});

test('una pagina sola più grande della finestra: la risposta arriva, e dice che ne ha tenuto solo l\'inizio', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  const url = testServer.html(paginaGrande('A'));
  await stub(app, [{ strumenti: [{ nome: 'LEGGI_PAGINA', args: { url } }] }, { finale: 'RISPOSTA_UNO' }], { margine: 30000 });
  await chiedi(page, `leggimi ${url}`);
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_UNO' });
  await expect(bolla).toBeVisible({ timeout: 40_000 });
  console.log('MISURE', JSON.stringify(await app.evaluate(() => ({ base: globalThis.__g.base, car: globalThis.__g.chiamate.map((c) => c.car) }))));
  await expect(bolla).toContainText('viste=MARCA_A_DENTRO');
  await expect(bolla).toContainText('ho tenuto solo l\'inizio');
});

test('se il rifiuto del fornitore arriva lo stesso, la frase dice cosa fare e non manda a cambiare modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await tre(app, testServer);
  await stub(app, PIANO_TRE, { rifiuto: 'sempre' });
  await chiedi(page, 'cerca i sentieri delle dolomiti e leggimi le guide');
  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText(/meno pagine|chat nuova/, { timeout: 40_000 });
  const testo = await bolla.innerText();
  expect(testo).not.toMatch(/Modelli predefiniti|scegli(?:ne)? un altro modello|cambia(?:re)? modello/i);
  const n = await app.evaluate(() => globalThis.__g.chiamate.length);
  expect(n, 'i tentativi finiscono').toBeLessThan(20);
  await page.screenshot({ path: 'tests/.shots/verifica-1596-errore.png' });
});
