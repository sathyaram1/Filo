// Verifica #578 giro 4, rilievo 1: un quadrato premuto mentre Filo prepara ancora la richiesta non ferma niente.
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
        if (signal) {
          if (signal.aborted) { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; ko(e); return; }
          signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; ko(e); }, { once: true });
        }
      });
      if (p.attesa) await aspetta(p.attesa);
      for (const pezzo of p.pensa || []) { try { onReasoning && onReasoning(pezzo); } catch (_) {} await aspetta(p.ogni || 120); }
      if (p.errore) { const e = new Error(p.errore); e.status = p.status || 500; throw e; }
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

// La lettura dello stato del computer (batteria, rete) e del saldo prima di chiamare il modello: su una macchina vera
// può durare mezzo secondo e più. Qui la si rallenta a 800 ms.
async function preparazioneLenta(app) {
  await app.evaluate(() => {
    const S = globalThis.SN_SISTEMA_MAIN;
    if (!S) { globalThis.SN_SISTEMA_MAIN = { statoPerChat: () => new Promise((ok) => setTimeout(() => ok(null), 800)) }; return; }
    const orig = S.statoPerChat;
    S.statoPerChat = async (...a) => { await new Promise((ok) => setTimeout(ok, 800)); return orig ? orig.apply(S, a) : null; };
  });
}

test('il quadrato premuto subito dopo l\'invio ferma davvero: nessuna azione, nessuna risposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await pronta(app, shell);
  await preparazioneLenta(app);
  await copione(app, [
    { pensa: ['Avvio il timer. '], ogni: 100, strumenti: [{ id: 'q1', name: 'TIMER', arguments: '{"secondi":77,"etichetta":"NonDoveva"}' }], dopoStrumenti: 100 },
    { pensa: ['Fatto. '], ogni: 100, testo: 'Timer avviato.' },
  ]);
  await page.locator('#input').fill('metti un timer');
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(300);
  await page.locator('#stopBtn').click();
  await expect(page.locator('.dash-activity')).toHaveAttribute('data-fermato', '1');
  await page.waitForTimeout(3_000);
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.map((t) => t.label)).not.toContain('NonDoveva');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Timer avviato.' })).toHaveCount(0);
  await expect(page.locator('.dash-bubble-fermato')).toBeVisible();
});
