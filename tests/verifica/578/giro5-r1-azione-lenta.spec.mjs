// Verifica #578 giro 5, rilievo 1: fermato durante un'azione lenta, la chat resta occupata finché l'azione non finisce.
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
async function pronta(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const M = globalThis.SN_FILO_MEMORY;
    await M.setOnboarding(globalThis.SN_ONBOARDING.close(await M.getOnboarding()));
  });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  return page;
}
async function copione(app, passi) {
  await app.evaluate(async (_, passiJson) => {
    const passi = JSON.parse(passiJson);
    const P = globalThis.SN_PROVIDERS;
    globalThis.__messaggi = [];
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
      for (const pezzo of p.pensa || []) { try { onReasoning && onReasoning(pezzo); } catch (_) {} await aspetta(p.ogni || 120); }
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

test('fermato durante una ricerca lenta: la chat torna libera subito, non a ricerca finita', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await pronta(app, shell);
  // Una ricerca sul web da 8 secondi (una rete lenta, un motore che tarda).
  await app.evaluate(() => {
    globalThis.SN_WEB_SEARCH = { search: async () => { await new Promise((r) => setTimeout(r, 8000)); return { results: [{ title: 't', url: 'https://example.com', content: 'x' }], provider: 'finto' }; } };
  });
  await copione(app, [
    { pensa: ['Cerco. '], ogni: 100, strumenti: [{ id: 's1', name: 'CERCA_WEB', arguments: '{"query":"orari treni"}' }], dopoStrumenti: 100 },
    { pensa: ['Ho trovato. '], ogni: 100, testo: 'Ecco gli orari.' },
  ]);
  await page.locator('#input').fill('orari treni');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-activity-seg-head').first()).toContainText(/Cerco/, { timeout: 5_000 });
  await page.waitForTimeout(800);
  await page.locator('#stopBtn').click();
  await expect(page.locator('.dash-activity')).toHaveAttribute('data-fermato', '1');
  // Chi ferma vuole fare altro: entro due secondi il posto dell'invio torna suo (riprendi o invia), e un seguito parte.
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 2_000 });
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi');
  await page.locator('#input').fill('lascia stare, che tempo fa?');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-user')).toHaveCount(2, { timeout: 2_000 });
});
