// #420 — "La risposta non compare mentre viene scritta": nella chat della home
// il testo e le azioni viaggiavano in un unico blocco JSON che andava ricevuto
// INTERO prima di mostrare anche solo la prima parola. Con un modello che ragiona
// e risposte lunghe erano secondi di schermo fermo.
//
// Fix: il main estrae il campo "text" dal JSON mentre arriva e pusha i delta alla
// scheda; la bolla si riempie mano a mano, le azioni arrivano in coda.
//
// Questi test asseriscono il SUCCESSO della feature:
//  (A) mentre il (finto) modello sta ancora scrivendo, in chat compare GIÀ una
//      parte della risposta (un frammento iniziale) ma NON ancora la coda — cosa
//      impossibile senza lo streaming del testo. Poi, a turno chiuso, il testo è
//      completo e l'azione in coda è cliccabile.
//  (B) una risposta di SOLA azione (text vuoto) NON lascia una bolla di testo
//      vuota che poi si riempie.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configureModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

test('la risposta compare MENTRE viene scritta, poi l’azione arriva in coda', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // Un sito del server di prova: con un sito vero il turno aspettava la rete (#1212.2).
  const sito = testServer.html('<title>Esempio</title><p>esempio</p>', { pubblico: true });

  // Provider in streaming: emette il JSON A PEZZI. Il campo "text" esce a
  // frammenti PRIMA che il blocco "actions" (in coda) arrivi, e a metà il
  // modello si ferma finché la prova non ha visto la bolla parziale: la finestra
  // «parte del testo c'è, la coda no» resta aperta quanto serve, non 500 ms.
  await app.evaluate(async (_, { sito: url }) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreStream = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    const vista = new Promise((r) => { globalThis.__metaVista = r; });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const full = JSON.stringify({
        text: 'PRIMA-FRASE. In mezzo scorre altro testo. ULTIMA-FRASE.',
        actions: [{ type: 'NAVIGA', url, label: 'Esempio' }],
      });
      const cut1 = full.indexOf('In mezzo');
      const cut2 = full.indexOf('ULTIMA-FRASE');
      try { onDelta && onDelta(full.slice(0, cut1)); } catch (_) {}
      try { onDelta && onDelta(full.slice(cut1, cut2)); } catch (_) {}
      await vista;
      try { onDelta && onDelta(full.slice(cut2)); } catch (_) {}
      return { text: full, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, { sito });

  await page.locator('#input').fill('ciao filo, aprimi https://example.com');
  await page.locator('#sendBtn').click();

  // SUCCESSO (streaming): mentre il modello scrive ancora, in chat c'è GIÀ il
  // frammento iniziale ma NON ancora la coda. Senza il fix la bolla comparirebbe
  // solo a fine turno, con tutto insieme → questo assert sarebbe rosso.
  await expect.poll(async () => {
    return page.evaluate(() => {
      const b = document.querySelector('.dash-bubble-streaming');
      if (!b) return null;
      const t = b.textContent || '';
      return { hasHead: t.includes('PRIMA-FRASE'), hasTail: t.includes('ULTIMA-FRASE') };
    });
  }, { timeout: 10_000 }).toEqual({ hasHead: true, hasTail: false });
  await expect(page.locator('#stopBtn')).toBeVisible();
  await app.evaluate(() => globalThis.__metaVista());

  // A turno chiuso (torna il tasto d'invio): il testo è completo e l'azione in coda è un bottone cliccabile. Il turno
  // finisce dopo l'apertura della pagina, che il main aspetta fino a 5 s (esitoApertura): il tetto la copre.
  await expect(page.locator('#stopBtn')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#sendBtn')).toBeVisible();
  await expect(page.locator('.dash-bubble-streaming')).toHaveCount(0);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'ULTIMA-FRASE' })).toBeVisible();
  await expect(page.locator('.dash-bubble-actions .dash-action-btn', { hasText: 'Esempio' })).toBeVisible();

  try { await page.screenshot({ path: 'tests/.shots/dashboard-chat-streaming.png' }); } catch (_) {}
  await app.evaluate(() => { try { globalThis.__restoreStream?.(); } catch (_) {} });
});

test('risposta di sola azione (text vuoto): niente bolla di testo vuota', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreStream2 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      await new Promise((r) => setTimeout(r, 300));
      // Solo azione, nessun testo: apre un link (il caso del feedback). URL
      // interno + secondo piano → deterministico, niente rete e niente focus rubato.
      const full = JSON.stringify({
        text: '',
        actions: [{ type: 'NAVIGA', url: 'filo://newtab/', label: 'Home', background: true }],
      });
      try { onDelta && onDelta(full); } catch (_) {}
      return { text: full, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });

  await page.locator('#input').fill('apri la home');
  await page.locator('#sendBtn').click();

  // L'azione compare a turno finito, e il turno aspetta fino a 5 s che la scheda aperta arrivi (esitoApertura)…
  await expect(page.locator('.dash-bubble-actions .dash-action-btn').first()).toBeVisible({ timeout: 20_000 });
  // …e non è mai rimasta a schermo una bolla di testo in streaming vuota.
  await expect(page.locator('.dash-bubble-streaming')).toHaveCount(0, { timeout: 3_000 });
  // La bolla di Filo non porta testo visibile (è "solo azioni").
  const filoText = await page.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll('.dash-bubble-filo'));
    // Escludi la riga azioni: guarda solo il testo diretto della bolla.
    return bubbles.map((b) => {
      const clone = b.cloneNode(true);
      clone.querySelectorAll('.dash-bubble-actions').forEach((n) => n.remove());
      return (clone.textContent || '').trim();
    }).join('|');
  });
  expect(filoText).toBe('');

  await app.evaluate(() => { try { globalThis.__restoreStream2?.(); } catch (_) {} });
});

// #1398: il testo che arriva dal fornitore è quello che la bolla mostra e la chat salva, lettera per lettera, anche
// quando la rete spezza la risposta a metà parola e a metà lettera accentata: dai byte della risposta HTTP alla bolla
// e al disco. Lo strato SSE da solo: tests/unit/chatTestoIntegro.test.mjs.
const RISPOSTA_1398 = 'Buon ascolto, e qui sono sempre io, quando vuoi.\n'
  + 'Fatto, applicato: d’ora in poi ti do del tu, e spendiamo meno parole sulla circostanza.\n'
  + 'Ho riletto «tutto»: è così, perché l’intervista è già finita 👍🏽. Città, più, già, né sì né no.';

// Il markdown fa di ogni riga un blocco suo e gli a capo spariscono dal testo: si confrontano le lettere, non gli spazi.
const lettere = (s) => String(s || '').replace(/\s+/g, '');

test('la risposta spezzata a metà parola arriva in bolla e su disco identica a quella ricevuta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await app.evaluate(async (_, risposta) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    // Pezzi da modello (1-5 caratteri, mai parole intere), poi i byte dell'SSE a fette di 1-7: la rete taglia righe,
    // JSON e lettere di più byte dove capita.
    const pezzi = [];
    for (let i = 0, k = 0; i < risposta.length; k++) { const n = [3, 1, 4, 2, 5][k % 5]; pezzi.push(risposta.slice(i, i + n)); i += n; }
    const righe = pezzi.map((p) => `data: ${JSON.stringify({ id: 'gen-1398', choices: [{ delta: { content: p } }], provider: 'Host' })}\n\n`);
    righe.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`, 'data: [DONE]\n\n');
    const bytes = new TextEncoder().encode(righe.join(''));
    const corpo = () => new ReadableStream({
      start(c) { for (let i = 0, k = 0; i < bytes.length; k++) { const n = 1 + (k * 5) % 7; c.enqueue(bytes.slice(i, i + n)); i += n; } c.close(); },
    });
    const OR = globalThis.SN_PROVIDER_OPENROUTER;
    const P = globalThis.SN_PROVIDERS;
    const orig = P.streamCompleteWithFallback;
    globalThis.__ricevuto = null;
    globalThis.__ripristina1398 = () => { P.streamCompleteWithFallback = orig; };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const fetchVero = globalThis.fetch;
      globalThis.fetch = async (url, init) => (String(url).includes('/chat/completions')
        ? new Response(corpo(), { status: 200 })
        : fetchVero(url, init));
      try {
        const r = await OR.streamComplete({ apiKey: 'k-test', model: attempts[0].model, messages, onDelta });
        globalThis.__ricevuto = r.text;
        return { ...r, model: attempts[0].model, provider: attempts[0].provider };
      } finally {
        globalThis.fetch = fetchVero;
      }
    };
  }, RISPOSTA_1398);

  await page.locator('#input').fill('dammi del tu');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 30_000 });

  const ricevuto = await app.evaluate(() => globalThis.__ricevuto);
  expect(ricevuto, 'il testo grezzo ricomposto dal fornitore').toBe(RISPOSTA_1398);

  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText('spendiamo meno parole');
  const mostrato = await bolla.evaluate((b) => {
    const c = b.cloneNode(true);
    c.querySelectorAll('.dash-bubble-actions').forEach((n) => n.remove());
    return c.textContent;
  });
  expect(lettere(mostrato), 'il testo nella bolla è quello ricevuto').toBe(lettere(RISPOSTA_1398));

  const salvato = await app.evaluate(async () => {
    const chats = await globalThis.SN_FILO_CHATS.list();
    const chat = chats.length ? await globalThis.SN_FILO_CHATS.get(chats[0].id) : null;
    const filo = (chat && chat.messages || []).filter((m) => m.role === 'filo');
    return filo.length ? filo[filo.length - 1].text : null;
  });
  expect(salvato, 'il testo salvato nella chat è quello ricevuto').toBe(RISPOSTA_1398);

  try { await page.screenshot({ path: 'tests/.shots/chat-testo-integro.png' }); } catch (_) {}
  await app.evaluate(() => { try { globalThis.__ripristina1398?.(); } catch (_) {} });
});
