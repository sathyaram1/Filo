// #1398 — l'italiano storpiato in chat («spesiamo», «son sempre lo», «rilegto»): Filo non perde né mescola pezzi del
// testo che riceve. Il fornitore finto manda lo stream SSE spezzato nei punti peggiori (a metà parola, a metà di una
// lettera accentata, a metà riga «data:» e di un escape JSON) e la bolla, l'archivio e l'intervista hanno lo stesso testo.

import { test, expect } from './fixtures/electron.mjs';

const RISPOSTA = 'Buon ascolto! Io sono sempre qui, ogni volta che vuoi. Fatto: da adesso ci diamo del tu, e spendiamo '
  + 'le parole solo per quello che serve. Ho riletto la segnalazione: «perché è così?», chiede l’utente "tra virgolette", '
  + 'e la città più vicina è a 3 km 🎧 già, così: niente caffè.';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash',
        [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
      },
    });
  });
}

// Il fornitore vero (fetch) finto: la risposta della chat esce a pezzetti di 1-4 caratteri, ognuno un evento SSE, e i
// byte arrivano a fette di 1-11 byte. Gli altri agenti (lezioni, memoria, home) rispondono interi e senza stream.
async function fornitoreSpezzato(app, contenuto) {
  await app.evaluate((_e, { contenuto: risposta }) => {
    globalThis.__chiamateChat = 0;
    if (!globalThis.__fetchVero) globalThis.__fetchVero = globalThis.fetch;
    const vero = globalThis.__fetchVero;
    const lati = [1, 2, 3, 5, 7, 11];
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) {
        const endpoints = [{ provider_name: 'DeepInfra', tag: 'deepinfra', supported_parameters: ['max_tokens', 'reasoning', 'tools'], max_completion_tokens: 65536 }];
        return new Response(JSON.stringify({ data: { endpoints } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (!u.includes('openrouter.ai/api/v1/chat/completions')) return vero(url, init);
      const body = JSON.parse(init.body);
      const tutto = JSON.stringify(body.messages || []);
      const chat = body.stream && !tutto.includes('integrare le nuove lezioni') && !tutto.includes('analizzare l') && !tutto.includes('preparare la dashboard');
      if (!chat) {
        const testo = tutto.includes('preparare la dashboard') ? JSON.stringify({ message: 'Buongiorno.', suggestions: [] }) : 'NESSUNA';
        if (body.stream) {
          const sse = `data: ${JSON.stringify({ id: 'gen-x', provider: 'DeepInfra', choices: [{ delta: { content: testo } }] })}\n\ndata: [DONE]\n\n`;
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ id: 'gen-x', provider: 'DeepInfra', choices: [{ message: { content: testo }, finish_reason: 'stop' }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      globalThis.__chiamateChat += 1;
      const pezzi = [];
      const caratteri = Array.from(risposta);
      for (let i = 0, k = 0; i < caratteri.length; k++) {
        const n = 1 + (k % 4);
        pezzi.push(caratteri.slice(i, i + n).join(''));
        i += n;
      }
      let sse = ': OPENROUTER PROCESSING\n\n';
      for (const p of pezzi) sse += `data: ${JSON.stringify({ id: 'gen-1', provider: 'DeepInfra', choices: [{ index: 0, delta: { role: 'assistant', content: p } }] })}\n\n`;
      sse += `data: ${JSON.stringify({ id: 'gen-1', provider: 'DeepInfra', choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 50 } })}\n\n`;
      sse += 'data: [DONE]\n\n';
      const byte = new TextEncoder().encode(sse);
      let at = 0;
      let k = 0;
      const stream = new ReadableStream({
        async pull(ctrl) {
          if (at >= byte.length) { ctrl.close(); return; }
          const n = lati[k++ % lati.length];
          ctrl.enqueue(byte.slice(at, at + n));
          at += n;
          if (k % 40 === 0) await new Promise((r) => setTimeout(r, 5));
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
  }, { contenuto });
}

// Ogni stato della bolla mentre si scrive: deve essere sempre un pezzo iniziale della risposta, mai un testo diverso.
async function registraBolla(page) {
  await page.evaluate(() => {
    window.__stati = [];
    const guarda = () => {
      const b = document.querySelector('.dash-bubble-streaming');
      if (b) window.__stati.push(b.textContent || '');
    };
    new MutationObserver(guarda).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}

const ultimaBollaDiFilo = (page) => page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.dash-bubble-filo')).pop();
  if (!b) return null;
  const c = b.cloneNode(true);
  c.querySelectorAll('.dash-bubble-actions, .dash-bubble-meta, .dash-reasoning, button').forEach((n) => n.remove());
  return (c.textContent || '').trim();
});

for (const [nome, contenuto] of [
  ['in prosa', RISPOSTA],
  ['dentro il JSON del formato vecchio', JSON.stringify({ text: RISPOSTA, actions: [] })],
]) {
  test(`chat della home, risposta ${nome} spezzata a metà parola e a metà lettera: bolla e archivio hanno il testo ricevuto`, async ({ app, shell }) => {
    test.setTimeout(90_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await expect(page.locator('#input')).toBeVisible();
    await configura(app);
    await fornitoreSpezzato(app, contenuto);
    await registraBolla(page);

    await page.locator('#input').fill('come va?');
    await page.locator('#sendBtn').click();
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => ultimaBollaDiFilo(page), { timeout: 15_000 }).toBe(RISPOSTA);
    expect(await app.evaluate(() => globalThis.__chiamateChat)).toBe(1);

    const stati = await page.evaluate(() => window.__stati);
    expect(stati.length, 'la risposta non è passata dalla bolla in diretta').toBeGreaterThan(3);
    for (const s of stati) expect(RISPOSTA.startsWith(s.trim()), `stato a metà non iniziale: «${s}»`).toBe(true);

    const archiviata = await app.evaluate(async () => {
      const chats = await globalThis.SN_FILO_CHATS.list();
      const c = chats.find((x) => (x.messages || []).some((m) => m.role === 'user' && m.text === 'come va?'));
      const m = c && c.messages.filter((x) => x.role !== 'user').pop();
      return m ? m.text : null;
    });
    expect(archiviata).toBe(RISPOSTA);
    try { await page.screenshot({ path: 'tests/.shots/chat-testo-intatto.png' }); } catch (_) {}
  });
}

test.describe('intervista di benvenuto', () => {
  test.use({ accoglienzaFatta: false });

  test('la risposta spezzata a metà parola e a metà lettera arriva intera nella bolla e nella conversazione salvata', async ({ app, shell }) => {
    test.setTimeout(90_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await configura(app);
    await fornitoreSpezzato(app, RISPOSTA);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
    await registraBolla(page);

    await page.locator('#input').fill('sono il creatore di Filo, ci lavoro con Claude Code');
    await page.locator('#sendBtn').click();
    await expect.poll(() => ultimaBollaDiFilo(page), { timeout: 30_000 }).toBe(RISPOSTA);

    const stati = await page.evaluate(() => window.__stati);
    for (const s of stati) expect(RISPOSTA.startsWith(s.trim()), `stato a metà non iniziale: «${s}»`).toBe(true);
    await expect.poll(async () => {
      const s = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding());
      const m = (s.thread || []).filter((x) => x.role === 'filo').pop();
      return m ? m.text : null;
    }, { timeout: 10_000 }).toBe(RISPOSTA);
    try { await page.screenshot({ path: 'tests/.shots/chat-testo-intatto-intervista.png' }); } catch (_) {}
  });
});
