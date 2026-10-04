// Verifica #578, giro 1, rilievo 1: fermare con un gesto ripetuto (doppio clic sul quadrato, Invio due volte) riprende il lavoro.
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
// Come il copione dello spec della feature, più `pezzi`: la risposta che arriva a pezzi, `ogniPezzo` ms l'uno.
async function copione(app, passi) {
  await app.evaluate(async (_, passiJson) => {
    const passi = JSON.parse(passiJson);
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__origStream) globalThis.__origStream = P.streamCompleteWithFallback;
    globalThis.__messaggi = [];
    globalThis.__chiamate = 0;
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, messages, signal, onReasoning, onDelta, onToolCall }) => {
      globalThis.__messaggi.push(messages);
      globalThis.__chiamate += 1;
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
      if (p.attesa) await aspetta(p.attesa);
      for (const pezzo of p.pensa || []) {
        try { onReasoning && onReasoning(pezzo); } catch (_) {}
        await aspetta(p.ogni || 120);
      }
      if (p.strumenti && p.strumenti.length) {
        for (const s of p.strumenti) { try { onToolCall && onToolCall({ id: s.id, name: s.name }); } catch (_) {} }
        await aspetta(p.dopoStrumenti || 200);
        return { ...base, text: '', toolCalls: p.strumenti, finishReason: 'tool_calls' };
      }
      if (p.pezzi) {
        for (const x of p.pezzi) { try { onDelta && onDelta(x); } catch (_) {} await aspetta(p.ogniPezzo || 300); }
        return { ...base, text: p.pezzi.join(''), toolCalls: [], finishReason: 'stop' };
      }
      const testo = p.testo || 'Fatto.';
      try { onDelta && onDelta(testo); } catch (_) {}
      return { ...base, text: testo, toolCalls: [], finishReason: 'stop' };
    };
  }, JSON.stringify(passi));
}
async function ripristina(app) {
  await app.evaluate(() => {
    if (globalThis.__origStream) globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.__origStream;
  });
}
async function pronta(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  return page;
}

test('doppio clic sul quadrato: ferma e basta, non riprende', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await pronta(app, shell);
  await copione(app, [
    { pensa: ['Penso a lungo. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. '], ogni: 900, testo: 'Mai.' },
    { pensa: ['Ripreso. '], ogni: 200, testo: 'Ripreso senza volerlo.' },
  ]);
  await page.locator('#input').fill('pensa');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-activity-trama')).toContainText('lungo', { timeout: 5_000 });
  // Un doppio clic vero: due clic nello stesso punto a un quinto di secondo.
  const b = await page.locator('#stopBtn').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(200);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(2500);
  expect(await app.evaluate(() => globalThis.__chiamate)).toBe(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ripreso senza volerlo.' })).toHaveCount(0);
  await ripristina(app);
});

test('Invio premuto due volte di fila: ferma e basta, non riprende', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await pronta(app, shell);
  await copione(app, [
    { pensa: ['Penso a lungo. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. '], ogni: 900, testo: 'Mai.' },
    { pensa: ['Ripreso. '], ogni: 200, testo: 'Ripreso senza volerlo.' },
  ]);
  await page.locator('#input').fill('pensa');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-activity-trama')).toContainText('lungo', { timeout: 5_000 });
  await page.locator('#input').press('Enter');
  await page.waitForTimeout(250);
  await page.locator('#input').press('Enter');
  await page.waitForTimeout(2500);
  expect(await app.evaluate(() => globalThis.__chiamate)).toBe(1);
  await ripristina(app);
});
