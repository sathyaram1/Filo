// #1669 giro 1 — r1: fra l'anteprima e l'OK la memoria impara il nome (la lezione del turno): l'OK deve far partire
// lo stesso la segnalazione, non perdersi per una firma che non combacia più.

import { test, expect } from '../../fixtures/electron.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('r1 la memoria impara il nome mentre il riquadro è aperto: l\'OK spedisce la segnalazione', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await livelloAutonomia(app, 'conservativo');
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: '', PREFERENZE: '' });
    globalThis.__submitted = [];
    globalThis.SN_FEEDBACK.submit = async (payload) => {
      globalThis.__submitted.push(payload);
      return { id: `fb-test-${globalThis.__submitted.length}` };
    };
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (n === 1) {
        try { onToolCall && onToolCall({ id: 'f1', name: 'INVIA_FEEDBACK' }); } catch (_) {}
        const args = { testo: 'Luca non riesce a esportare la chat in PDF.', titolo: 'Export PDF bloccato' };
        return { ...base, text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify(args) }], reasoningDetails: [], finishReason: 'tool_calls' };
      }
      const finale = 'Ti ho preparato la segnalazione: conferma e parte.';
      try { onDelta && onDelta(finale); } catch (_) {}
      return { ...base, text: finale, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
  // L'OK arriva solo quando il test lo dà, dopo che la memoria ha imparato il nome.
  await page.evaluate(() => {
    window.__confirmSeen = [];
    let via;
    window.__via = new Promise((r) => { via = r; });
    window.__dai = () => via(true);
    const chiedi = async (opts) => { window.__confirmSeen.push(opts && opts.text); return window.__via; };
    window.SN_CONFIRM_UI = { confirm: chiedi, confirmTyped: chiedi };
  });

  await page.locator('#input').fill('sono Luca, manda un feedback: non riesco a esportare la chat in PDF');
  await page.locator('#sendBtn').click();
  await expect.poll(() => page.evaluate(() => (window.__confirmSeen || []).length), { timeout: 20_000 }).toBeGreaterThan(0);

  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'L\'utente si chiama Luca Moretti (fonti: R1)', PREFERENZE: '' });
  });
  await page.evaluate(() => window.__dai());

  await expect.poll(() => app.evaluate(() => globalThis.__submitted.length), { timeout: 10_000 }).toBe(1);
});
