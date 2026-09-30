// Verifica #553, giro 14: un indirizzo normale scritto dal modello (la pagina dei prezzi che conosce, un link profondo
// aperto dopo una ricerca) non è un blocco di dati; e dopo il sì dell'utente la lettura torna al modello da sola.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function stubModello(app, piani) {
  await app.evaluate(async (_e, piani) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages))) - 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const piano = piani[Math.min(n, piani.length - 1)];
      const esiti = messages.filter((m) => m.role !== 'system').map((m) => String(m.content || '')).join('\n');
      if (piano.finale) {
        const m = new RegExp(piano.finale.cerca).exec(esiti);
        const text = piano.finale.testo.replace('$1', m ? m[1] : 'NON_TROVATO');
        try { onDelta && onDelta(text); } catch (_) {}
        return { ...base, text, toolCalls: [], finishReason: 'stop' };
      }
      const toolCalls = piano.strumenti.map((s, i) => ({ id: `c${n}_${i}`, name: s.nome, arguments: JSON.stringify(s.args || {}) }));
      for (const c of toolCalls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      return { ...base, text: '', toolCalls, finishReason: 'tool_calls' };
    };
  }, piani);
}

const LISTINO = `<!doctype html><html lang="it"><head><title>Prezzi dell'API</title></head><body><main>
<h1>Prezzi</h1><p>I prezzi sono espressi in dollari per milione di token, al netto delle imposte, per tutte le richieste
fatte con una chiave a pagamento. Le richieste in lotti costano la metà.</p>
<table><tr><th>Modello</th><th>Ingresso</th><th>Uscita</th></tr><tr><td>Gemini 2.5 Pro</td><td>1,25</td><td>10,00</td></tr></table>
</main></body></html>`;

// Qualunque indirizzo risponde col listino: qui conta cosa succede PRIMA che la richiesta parta.
async function reteFinta(app) {
  await app.evaluate((_e, html) => {
    globalThis.__scaricati = [];
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async (url) => {
      globalThis.__scaricati.push(url);
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
  }, LISTINO);
}

async function confermeFinte(page) {
  await page.evaluate(() => {
    window.__confermeViste = [];
    window.SN_CONFIRM_UI = {
      confirm: async (o) => { window.__confermeViste.push(o && o.text); return true; },
      confirmTyped: async (o) => { window.__confermeViste.push(o && o.text); return true; },
    };
  });
}

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('«quanto costa Gemini 2.5 Pro?»: Filo legge la pagina dei prezzi che conosce senza allarme e risponde', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await reteFinta(app);
  await stubModello(app, [
    { strumenti: [{ nome: 'LEGGI_PAGINA', args: { url: 'https://ai.google.dev/gemini-api/docs/pricing' } }] },
    { finale: { cerca: 'Gemini 2\\.5 Pro \\| ([\\d,]+)', testo: 'RISPOSTA: $1 dollari per milione di token in ingresso.' } },
  ]);
  await chiedi(page, 'quanto costa gemini 2.5 pro?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA: 1,25 dollari' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.dash-bubble-actions .dash-action-btn-primary')).toHaveCount(0);
});

test('dopo aver letto una pagina, «aprimi la pagina dei prezzi» apre la scheda senza avviso di dati in uscita', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await reteFinta(app);
  await app.evaluate(() => {
    globalThis.SN_WEB_SEARCH.search = async () => ({ ok: true, provider: 'stub', results: [
      { title: 'Listino', url: 'https://notizie.example/listino-modelli', snippet: 'I prezzi dei modelli.' },
    ] });
  });
  const url = 'https://ai.google.dev/gemini-api/docs/pricing';
  await stubModello(app, [
    { strumenti: [{ nome: 'CERCA_WEB', args: { query: 'prezzi gemini 2.5 pro' } }] },
    { strumenti: [{ nome: 'LEGGI_PAGINA', args: { url: 'https://notizie.example/listino-modelli' } }] },
    { finale: { cerca: 'Gemini 2\\.5 Pro \\| ([\\d,]+)', testo: 'PRIMA: $1 dollari.' } },
    { strumenti: [{ nome: 'NAVIGA', args: { url } }] },
    { finale: { cerca: '(x)', testo: 'SECONDA: aperta.' } },
  ]);
  await chiedi(page, 'quanto costa gemini 2.5 pro?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'PRIMA: 1,25 dollari' })).toBeVisible({ timeout: 20_000 });
  await chiedi(page, 'aprimi la pagina ufficiale dei prezzi');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'SECONDA:' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.dash-bubble-actions .dash-action-btn-primary')).toHaveCount(0);
  await expect.poll(() => app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()
    .some((w) => w._filoTabs && w._filoTabs.tabs.some((t) => String(t.url || '').startsWith(u))), url), { timeout: 10_000 }).toBe(true);
});

test('una lettura confermata dall\'utente torna al modello da sola, e la risposta arriva senza riscrivere', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await confermeFinte(page);
  await reteFinta(app);
  // Un codice lungo nell'indirizzo chiede conferma anche quando la regola sulla forma è giusta.
  const url = 'https://negozio.example/listino?sessione=8f3a9c2e7b1d4f6a9c2e7b1d4f6a0b1c';
  await stubModello(app, [
    { strumenti: [{ nome: 'LEGGI_PAGINA', args: { url } }] },
    { finale: { cerca: '(NON_ESISTE_MAI)', testo: 'ATTESA: aspetto la tua conferma.' } },
    { finale: { cerca: 'Gemini 2\\.5 Pro \\| ([\\d,]+)', testo: 'RISPOSTA: $1 dollari.' } },
  ]);
  await chiedi(page, 'quanto costa gemini 2.5 pro su quel listino?');
  const bottone = page.locator('.dash-bubble-actions .dash-action-btn-primary');
  await expect(bottone).toHaveCount(1, { timeout: 20_000 });
  await bottone.click();
  await expect.poll(() => app.evaluate(() => globalThis.__scaricati.length), { timeout: 10_000 }).toBe(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA: 1,25 dollari' })).toBeVisible({ timeout: 20_000 });
});
