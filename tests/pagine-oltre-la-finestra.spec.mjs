// #1596 — tre pagine lette nello stesso turno che insieme non stanno nella finestra del modello: Filo ne tiene quante
// ci stanno, dice in chat quali ha lasciato fuori e risponde; chiedendolo le rilegge; se non basta, l'errore dice cosa fare.
// Il modello è finto e rifiuta come OpenRouter oltre una soglia di caratteri; il server di prova sta su 127.0.0.1.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const URL_RE = 'http://127\\.0\\.0\\.1:\\d+/\\d+';
const MARCHI = ['ALFA', 'BETA', 'GAMMA'];
// Una finestra dove la chat sta con una pagina e mezza: il resto lo prendono istruzioni, strumenti e tetto della risposta.
const FINESTRA = 72000;

// Una pagina da circa 60.000 token: il marchio sta in cima, dentro il primo pezzo che Filo legge.
function paginaEnorme(nome) {
  const riga = `Paragrafo della pagina ${nome} con dati, prezzi e orari da leggere con calma prima di rispondere. `;
  const corpo = Array.from({ length: 2200 }, (_, i) => `<p>${i}. ${riga}</p>`).join('\n');
  return `<!doctype html><html lang="it"><head><title>Guida ${nome}</title></head><body><main><article>
<h1>Guida ${nome}</h1><p>MARCHIO_${nome}: il dato che serve sta qui.</p>
${corpo}
</article></main></body></html>`;
}

// Il fornitore finto conta come OpenRouter: messaggi e strumenti, più il tetto della risposta. Oltre `finestra` token
// rifiuta, con le misure (o senza, `misure: false`). `listino`: il listino di OpenRouter dice la stessa finestra.
// `piani`: uno per richiesta accettata; `strumenti` chiama azioni prendendo l'indirizzo dagli esiti già tornati
// (`urlDa`, o il gruppo 1 di `gruppoDa`), `finale` risponde dicendo quali marchi ha davanti. `posto`: al posto di
// `finestra`, i caratteri liberi oltre la prima richiesta della chat (la finestra si misura lì).
// `anthropic`: il rifiuto arriva com'è dietro OpenRouter, dentro «Provider returned error», e passa dal lettore vero
// degli errori; `pesante`: il fornitore conta il testo più pesante di come lo stima Filo.
async function modello(app, { finestra = 0, posto = 0, listino = false, misure = true, piani, anthropic = false, pesante = false }) {
  await app.evaluate(async (_e, { finestra, posto, listino, misure, piani, anthropic, pesante }) => {
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
      const ingresso = Math.ceil((testi.reduce((s, t) => s + t.length, 0) + (tools ? JSON.stringify(tools).length : 0)) / (pesante ? 3.2 : 3.5));
      const uscita = Number(attempts[0].maxTokens) || 16384;
      if (!finestra) finestra = ingresso + uscita + Math.ceil(posto / 3.5);
      if (ingresso + uscita > finestra) {
        globalThis.__rifiutate++;
        if (anthropic) {
          const message = ingresso > finestra ? `prompt is too long: ${ingresso} tokens > ${finestra} maximum`
            : `input length and \`max_tokens\` exceed context limit: ${ingresso} + ${uscita} > ${finestra}, decrease input length or \`max_tokens\` and try again`;
          const raw = JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } });
          const body = JSON.stringify({ error: { message: 'Provider returned error', code: 400, metadata: { raw, provider_name: 'Anthropic' } } });
          throw await globalThis.SN_PROVIDER_OPENROUTER.httpError(new Response(body, { status: 400 }), { tools: !!tools, maxTokens: uscita, model: attempts[0].model });
        }
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
  }, { finestra, posto, listino, misure, piani, anthropic, pesante });
}

async function preparaPagine(app, testServer) {
  const urls = MARCHI.map((x) => testServer.html(paginaEnorme(x)));
  await app.evaluate((_e, results) => {
    globalThis.SN_WEB_SEARCH.search = async () => ({ ok: true, provider: 'stub', results });
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    // Lo scaricatore vero rifiuta 127.0.0.1.
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async (url, opts) => fetch(url, opts);
  }, urls.map((url, i) => ({ title: `Guida ${MARCHI[i]}`, url, snippet: 'Una guida lunghissima.' })));
  return urls;
}

const RICERCA_E_TRE_PAGINE = [
  { strumenti: [{ nome: 'CERCA_WEB', args: { query: 'guide' } }] },
  { strumenti: [0, 1, 2].map((indice) => ({ nome: 'LEGGI_PAGINA', urlDa: URL_RE, indice })) },
  { finale: 'RISPOSTA PRONTA' },
];

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

for (const caso of [
  { nome: 'senza la finestra nota, il rifiuto del fornitore', listino: false, rifiuti: (n) => expect(n).toBeGreaterThan(0) },
  { nome: 'senza le misure nel rifiuto, a metà per volta', listino: false, misure: false, rifiuti: (n) => expect(n).toBeGreaterThan(0) },
  { nome: 'con la finestra nota dal listino, prima di mandare', listino: true, rifiuti: (n) => expect(n).toBe(0) },
  // Il testo ci starebbe, col tetto della risposta no: Anthropic lo dice con «ingresso + tetto > finestra».
  { nome: 'Anthropic, ingresso più tetto oltre la finestra', listino: false, anthropic: true, rifiuti: (n) => expect(n).toBeGreaterThan(0) },
  { nome: 'Anthropic, finestra nota ma testo contato più pesante', listino: true, anthropic: true, pesante: true, rifiuti: (n) => expect(n).toBeGreaterThan(0) },
]) {
  test(`tre pagine enormi nello stesso turno (${caso.nome}): la risposta arriva con la prima pagina e in chat c'è l'avviso delle altre`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    const page = await openTab(NEWTAB);
    const urls = await preparaPagine(app, testServer);
    await modello(app, { finestra: FINESTRA, listino: caso.listino, misure: caso.misure !== false, anthropic: !!caso.anthropic, pesante: !!caso.pesante, piani: RICERCA_E_TRE_PAGINE });

    await chiedi(page, 'confronta le tre guide che trovi');

    const bolla = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA PRONTA' });
    await expect(bolla).toBeVisible({ timeout: 40_000 });
    // La prima pagina chiesta il modello l'ha davanti intera; la terza no.
    await expect(bolla).toContainText('visti: ALFA');
    await expect(bolla).not.toContainText('GAMMA');
    // L'avviso è nella bolla, coi siti, e dice che si possono rileggere.
    await expect(bolla).toContainText('Il modello non riusciva a leggere tutto insieme');
    await expect(bolla).toContainText(/chiedimi di rileggerl[ae]/);
    await expect(bolla).toContainText('127.0.0.1');
    caso.rifiuti(await app.evaluate(() => globalThis.__rifiutate));

    // Al modello le pagine tolte arrivano come rimando: titolo e indirizzo, nessun testo inventabile.
    const ultima = (await app.evaluate(() => globalThis.__accettate)).pop();
    expect(ultima).toContain('lasciata fuori');
    expect(ultima).toContain('Titolo: Guida GAMMA');
    expect(ultima).toContain(`Indirizzo: ${urls[2]}`);
    expect(ultima).not.toContain('MARCHIO_GAMMA');
  });
}

test('le pagine lasciate fuori si rileggono chiedendolo, e la pagina riletta arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const page = await openTab(NEWTAB);
  await preparaPagine(app, testServer);
  await modello(app, {
    finestra: FINESTRA,
    piani: [
      ...RICERCA_E_TRE_PAGINE,
      // Turno dopo: l'indirizzo lo prende dal rimando che ha davanti, come farebbe il modello.
      { strumenti: [{ nome: 'LEGGI_PAGINA', gruppoDa: `lasciata fuori[\\s\\S]*?Titolo: Guida GAMMA[\\s\\S]*?Indirizzo: (${URL_RE})` }] },
      { finale: 'RILETTA' },
    ],
  });
  await chiedi(page, 'confronta le tre guide che trovi');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA PRONTA' })).toBeVisible({ timeout: 40_000 });

  await chiedi(page, 'rileggi la guida GAMMA che hai lasciato fuori');
  const riletta = page.locator('.dash-bubble-filo', { hasText: 'RILETTA' });
  await expect(riletta).toBeVisible({ timeout: 40_000 });
  await expect(riletta).toContainText(/visti: [^)]*GAMMA/);
  // Riletta, la pagina è davanti al modello per intero: niente avviso su di lei.
  await expect(riletta).not.toContainText('non riusciva a leggere');
});

test('se il fornitore rifiuta anche dopo aver accorciato tutto, l\'errore dice cosa fare e non manda a cambiare modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await preparaPagine(app, testServer);
  // Nessuna richiesta ci sta, nemmeno la prima.
  await modello(app, { finestra: 20000, piani: RICERCA_E_TRE_PAGINE });
  await chiedi(page, 'confronta le tre guide che trovi');
  const errore = page.locator('.dash-bubble-filo', { hasText: 'meno pagine' });
  await expect(errore).toBeVisible({ timeout: 40_000 });
  await expect(errore).toContainText('chat nuova');
  await expect(errore).not.toContainText(/altro modello|Modelli predefiniti/);
  // «Riprova» manderebbe la stessa richiesta contro lo stesso limite: la chat nuova che la frase consiglia è un tasto,
  // e il messaggio torna nel campo da accorciare o mandare.
  await errore.locator('button', { hasText: 'Chat nuova' }).click();
  await expect(page.locator('#input')).toHaveValue('confronta le tre guide che trovi');
  await expect(page.locator('#input')).toBeFocused();
  await modello(app, { finestra: 200000, piani: [{ finale: 'RISPOSTA_NELLA_NUOVA' }] });
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_NELLA_NUOVA' })).toBeVisible({ timeout: 40_000 });
});

test('una pagina sola più grande del posto rimasto: il modello ne ha davanti l\'inizio, e lo stesso quando la si rilegge', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  const [url] = await preparaPagine(app, testServer);
  const leggi = { strumenti: [{ nome: 'LEGGI_PAGINA', args: { url } }] };
  // Posto per due terzi della pagina: il taglio dopo il rifiuto ne lascia la parte che ci sta, non solo il rimando.
  await modello(app, { posto: 20000, piani: [leggi, { finale: 'LETTURA_UNO' }, leggi, { finale: 'LETTURA_DUE' }] });
  await chiedi(page, `leggimi ${url}`);
  const prima = page.locator('.dash-bubble-filo', { hasText: 'LETTURA_UNO' });
  await expect(prima).toBeVisible({ timeout: 40_000 });
  await expect(prima).toContainText('visti: ALFA');
  await expect(prima).toContainText('ho tenuto solo l\'inizio');
  await chiedi(page, 'rileggila');
  const seconda = page.locator('.dash-bubble-filo', { hasText: 'LETTURA_DUE' });
  await expect(seconda).toBeVisible({ timeout: 40_000 });
  await expect(seconda).toContainText('visti: ALFA');
});
