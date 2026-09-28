// #592 giro 21, rilievo 2: dato l'OK, il bottone nella risposta dice cosa è
// stato fatto, non «Filo vuole…» con la spunta davanti.
import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, CONFIRM_HOST } from '../../helpers/confirm.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function preparaChat(app, giri) {
  await app.evaluate(async (_e, g) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const sys = (messages.find((m) => m.role === 'system') || {}).content || '';
      if (!String(sys).includes('═══ CONTENUTO ESTERNO ═══')) {
        return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: 'NULLA DA IMPARARE', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      }
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, giri);
}

for (const [caso, chiamata] of [
  ['lezione', { id: 'a1', name: 'SALVA_LEZIONE', arguments: JSON.stringify({ testo: 'L’utente è vegetariano.' }) }],
  ['stile', { id: 'a2', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'stile_agente', valore: 'Rispondi breve.' }) }],
]) {
  test(`in chat, dopo l'OK sul popup (${caso}), il bottone nella risposta dice cosa è stato fatto`, async ({ app, shell }) => {
    test.setTimeout(60_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await preparaChat(app, [{ toolCalls: [chiamata] }, { text: 'Ti chiedo conferma.' }]);
    await page.locator('#input').fill('ricordati che sono vegetariano, e rispondimi breve');
    await page.locator('#sendBtn').click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);
    await clickConfirm(page, 'ok');
    const chip = page.locator('.dash-bubble-filo button', { hasText: '✓' });
    await expect(chip).toHaveCount(1, { timeout: 5_000 });
    await expect(chip, 'a cosa fatta il bottone dice ancora «Filo vuole…»').not.toContainText('vuole');
  });
}
