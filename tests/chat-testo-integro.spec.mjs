// #1398: il testo che arriva dal fornitore è quello che la bolla mostra e la chat salva, lettera per lettera, anche
// quando la rete spezza la risposta a metà parola e a metà lettera accentata. Lo strato SSE da solo: unit
// chatTestoIntegro; qui tutta la catena, dai byte della risposta HTTP alla bolla e al disco.

import { test, expect } from './fixtures/electron.mjs';

const RISPOSTA = 'Buon ascolto, e qui sono sempre io, quando vuoi.\n'
  + 'Fatto, applicato: d’ora in poi ti do del tu, e spendiamo meno parole sulla circostanza.\n'
  + 'Ho riletto «tutto»: è così, perché l’intervista è già finita 👍🏽. Città, più, già, né sì né no.';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

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
  }, RISPOSTA);

  await page.locator('#input').fill('come vuoi che ti parli?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 30_000 });

  const ricevuto = await app.evaluate(() => globalThis.__ricevuto);
  expect(ricevuto, 'il testo grezzo ricomposto dal fornitore').toBe(RISPOSTA);

  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText('spendiamo meno parole');
  const mostrato = await bolla.evaluate((b) => {
    const c = b.cloneNode(true);
    c.querySelectorAll('.dash-bubble-actions').forEach((n) => n.remove());
    return c.textContent;
  });
  expect(lettere(mostrato), 'il testo nella bolla è quello ricevuto').toBe(lettere(RISPOSTA));

  const salvato = await app.evaluate(async () => {
    const chats = await globalThis.SN_FILO_CHATS.list();
    const chat = chats.length ? await globalThis.SN_FILO_CHATS.get(chats[0].id) : null;
    const filo = (chat && chat.messages || []).filter((m) => m.role === 'filo');
    return filo.length ? filo[filo.length - 1].text : null;
  });
  expect(salvato, 'il testo salvato nella chat è quello ricevuto').toBe(RISPOSTA);

  try { await page.screenshot({ path: 'tests/.shots/chat-testo-integro.png' }); } catch (_) {}
  await app.evaluate(() => { try { globalThis.__ripristina1398?.(); } catch (_) {} });
});
