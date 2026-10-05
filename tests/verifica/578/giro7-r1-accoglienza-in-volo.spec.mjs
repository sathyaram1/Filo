// Verifica #578, giro 7, rilievo 1: uno stop nell'accoglienza deve tenere anche se un'azione fermata è ancora in volo.
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
async function senzaAccoglienza(app, page) {
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.setOnboarding(globalThis.SN_ONBOARDING.close(await M.getOnboarding()));
  });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
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
// passi: { pensa, ogni, strumenti, dopoStrumenti, testo, pezziTesto, ogniTesto }
async function copione(app, passi) {
  await app.evaluate(async (_, passiJson) => {
    const passi = JSON.parse(passiJson);
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__origStream) globalThis.__origStream = P.streamCompleteWithFallback;
    globalThis.__messaggi = [];
    globalThis.__timer = 0;
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, messages, signal, onReasoning, onDelta, onToolCall }) => {
      globalThis.__messaggi.push(messages);
      const p = passi[Math.min(n, passi.length - 1)];
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const aspetta = (ms) => new Promise((ok, ko) => {
        const t = setTimeout(ok, ms);
        if (signal) {
          if (signal.aborted) { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; ko(e); return; }
          signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; ko(e); }, { once: true });
        }
      });
      for (const pezzo of p.pensa || []) {
        try { onReasoning && onReasoning(pezzo); } catch (_) {}
        if (p.ogni) await aspetta(p.ogni);
      }
      if (p.strumenti && p.strumenti.length) {
        for (const s of p.strumenti) { try { onToolCall && onToolCall({ id: s.id, name: s.name }); } catch (_) {} }
        await aspetta(p.dopoStrumenti || 200);
        return { ...base, text: '', toolCalls: p.strumenti, finishReason: 'tool_calls' };
      }
      if (p.pezziTesto) {
        let tutto = '';
        for (const x of p.pezziTesto) { tutto += x; try { onDelta && onDelta(x); } catch (_) {} await aspetta(p.ogniTesto || 300); }
        return { ...base, text: tutto, toolCalls: [], finishReason: 'stop' };
      }
      const testo = p.testo || 'Fatto.';
      try { onDelta && onDelta(testo); } catch (_) {}
      return { ...base, text: testo, toolCalls: [], finishReason: 'stop' };
    };
  }, JSON.stringify(passi));
}

async function ricercaLenta(app, ms) {
  await app.evaluate((_, durata) => {
    globalThis.__ricerche = 0;
    globalThis.SN_WEB_SEARCH = { search: async () => { globalThis.__ricerche += 1; await new Promise((r) => setTimeout(r, durata)); return { results: [{ title: 'O', url: 'https://example.com/o', content: 't' }], provider: 'finto' }; } };
  }, ms);
}
async function fermaDuranteRicerca(app, page) {
  await ricercaLenta(app, 8_000);
  await copione(app, [
    { pensa: ['Cerco Luca. '], ogni: 100, dopoStrumenti: 100, strumenti: [{ id: 'o1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: `Luca ${Date.now()}` }) }] },
    { pensa: ['Rispondo. '], ogni: 100, testo: 'Piacere Luca.' },
  ]);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await page.locator('#input').fill('mi chiamo Luca');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-activity-seg-head').last()).toHaveText(/Cerco sul web/, { timeout: 6_000 });
  // La ricerca è partita davvero: lo stop la trova in volo.
  await expect.poll(() => app.evaluate(() => globalThis.__ricerche), { timeout: 5_000 }).toBe(1);
  await page.locator('#stopBtn').click();
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 3_000 });
}

test('accoglienza fermata con la ricerca ancora in volo, pagina ricaricata subito: il turno non riparte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await fermaDuranteRicerca(app, page);
  await page.reload();
  await expect(page.locator('.dash-bubble-fermato')).toHaveText('Fermato prima della risposta.', { timeout: 15_000 });
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi');
  await page.waitForTimeout(10_000);
  expect(await app.evaluate(() => globalThis.__messaggi.length)).toBe(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Luca' })).toHaveCount(0);
});

test('accoglienza fermata con la ricerca ancora in volo, scheda nuova aperta subito: il turno non riparte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await fermaDuranteRicerca(app, page);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await expect.poll(() => app.windows().filter((w) => w.url().startsWith('filo://newtab')).length, { timeout: 10_000 }).toBe(2);
  const nuova = app.windows().find((w) => w.url().startsWith('filo://newtab') && w !== page);
  await expect(nuova.locator('.dash-bubble-fermato')).toHaveText('Fermato prima della risposta.', { timeout: 15_000 });
  await page.waitForTimeout(10_000);
  expect(await app.evaluate(() => globalThis.__messaggi.length)).toBe(1);
  await expect(nuova.locator('.dash-bubble-filo', { hasText: 'Piacere Luca' })).toHaveCount(0);
});
