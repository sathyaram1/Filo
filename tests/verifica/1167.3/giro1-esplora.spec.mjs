import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__ricerche = 0;
    globalThis.__ricercheFinite = 0;
    const trattenuta = new Promise((ok) => { globalThis.__lasciaRicerca = ok; });
    globalThis.SN_WEB_SEARCH = { search: async () => {
      globalThis.__ricerche += 1;
      await trattenuta;
      globalThis.__ricercheFinite += 1;
      return { results: [{ title: 'Orari', url: 'https://example.com/orari', content: 'treni' }], provider: 'finto' };
    } };
    const passi = [
      { strumenti: [{ id: 'm1', name: 'CERCA_WEB', arguments: '{"query":"orari treni"}' }] },
      { testo: 'Ecco gli orari.' },
    ];
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__origStream) globalThis.__origStream = P.streamCompleteWithFallback;
    globalThis.__messaggi = [];
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, messages, signal, onReasoning, onDelta, onToolCall }) => {
      globalThis.__messaggi.push(messages);
      const p = passi[Math.min(n, passi.length - 1)];
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const aspetta = (ms) => new Promise((ok, ko) => {
        const t = setTimeout(ok, ms);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; ko(e); }, { once: true });
      });
      onReasoning && onReasoning('Penso. ');
      await aspetta(100);
      if (p.strumenti) {
        for (const s of p.strumenti) onToolCall && onToolCall({ id: s.id, name: s.name });
        await aspetta(100);
        return { ...base, text: '', toolCalls: p.strumenti, finishReason: 'tool_calls' };
      }
      onDelta && onDelta(p.testo);
      return { ...base, text: p.testo, toolCalls: [], finishReason: 'stop' };
    };
  });
}

test('esplora — fermo, riprendi, di nuovo fermo durante l\'attesa, riprendi: la ricerca resta una e la risposta arriva', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await prepara(app);
  await page.locator('#input').fill('orari treni');
  await page.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__ricerche), { timeout: 5_000 }).toBe(1);
  await page.locator('#stopBtn').click();
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#stopBtn')).toBeVisible();
  await page.waitForTimeout(300);
  await page.locator('#stopBtn').click();
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi');
  await page.waitForTimeout(300);
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(300);
  expect(await app.evaluate(() => globalThis.__messaggi.length)).toBe(1);
  await app.evaluate(() => globalThis.__lasciaRicerca());
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco gli orari.' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);
  expect(await app.evaluate(() => globalThis.__ricerche)).toBe(1);
  expect(await app.evaluate(() => globalThis.__messaggi.length)).toBe(2);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco gli orari.' })).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/v1167-3-doppio-fermo.png' });
  await app.evaluate(() => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.__origStream; });
});

test('esplora — fermo e riprendi con la ricerca in volo, poi la ricerca fallisce: la risposta arriva lo stesso', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await prepara(app);
  await app.evaluate(() => {
    const vecchia = globalThis.SN_WEB_SEARCH.search;
    globalThis.SN_WEB_SEARCH = { search: async (...a) => { await vecchia(...a); throw new Error('rete giù'); } };
  });
  await page.locator('#input').fill('orari treni');
  await page.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__ricerche), { timeout: 5_000 }).toBe(1);
  await page.locator('#stopBtn').click();
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi');
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(300);
  await app.evaluate(() => globalThis.__lasciaRicerca());
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco gli orari.' })).toBeVisible({ timeout: 10_000 });
  expect(await app.evaluate(() => globalThis.__ricerche)).toBe(1);
  expect(await app.evaluate(() => globalThis.__messaggi.length)).toBe(2);
  await app.evaluate(() => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.__origStream; });
});
