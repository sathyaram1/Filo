// Verifica #578, giro 7, rilievo 2: l'azione in volo di un lavoro fermato non fa aspettare un'altra chat.
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

test('fermato con una ricerca lenta in volo, poi una chat nuova: la sua risposta non aspetta la ricerca vecchia', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  await app.evaluate(() => {
    globalThis.__ricerche = 0;
    globalThis.SN_WEB_SEARCH = { search: async () => { globalThis.__ricerche += 1; await new Promise((r) => setTimeout(r, 10_000)); return { results: [{ title: 'O', url: 'https://example.com/o', content: 't' }], provider: 'finto' }; } };
  });
  await copione(app, [
    { pensa: ['Cerco. '], ogni: 100, dopoStrumenti: 100, strumenti: [{ id: 's1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: `orari ${Date.now()}` }) }] },
    { pensa: ['Rispondo. '], ogni: 100, testo: 'Risposta nuova.' },
  ]);
  await page.locator('#input').fill('orari');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-activity-seg-head').first()).toHaveText(/Cerco sul web/, { timeout: 5_000 });
  // La ricerca è partita davvero: lo stop la trova in volo.
  await expect.poll(() => app.evaluate(() => globalThis.__ricerche), { timeout: 5_000 }).toBe(1);
  await page.locator('#stopBtn').click();
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 2_000 });
  await page.locator('#input').fill('/home');
  await page.locator('#input').press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 3_000 });
  await page.locator('#input').fill('domanda nuova');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta nuova.' })).toBeVisible({ timeout: 3_000 });
});
