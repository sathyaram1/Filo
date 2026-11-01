// #1669 giro 3 — l'utente scrive il proprio nome in minuscolo nel messaggio («sono luca, …») e la proposta di
// segnalazione lo cita così com'è: la rete toglie solo il nome con la maiuscola, e il nome arriva nel riquadro.

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

test('r1 il nome scritto in minuscolo dall\'utente non arriva nella segnalazione proposta', async ({ app, shell }) => {
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
    globalThis.__submitted = [];
    globalThis.SN_FEEDBACK.submit = async (payload) => {
      globalThis.__submitted.push(payload);
      return { id: `fb-test-${globalThis.__submitted.length}` };
    };
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'L\'utente si chiama Luca Moretti e lavora come grafico.', PREFERENZE: '' });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const text = JSON.stringify({ text: 'Non ho accesso al saldo dei crediti: lo trovi in Opzioni, alla voce Crediti e consumi.', actions: [] });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
  await page.evaluate(() => {
    window.__confirmSeen = [];
    window.SN_CONFIRM_UI = {
      confirm: async (opts) => { window.__confirmSeen.push(opts && opts.text); return true; },
      confirmTyped: async (opts) => { window.__confirmSeen.push(opts && opts.text); return true; },
    };
  });

  await page.locator('#input').fill('ciao sono luca, quanti crediti ho?');
  await page.locator('#sendBtn').click();

  await expect(page.locator('.dash-bubble-actions .dash-action-btn-primary', { hasText: /Inviare questo feedback/i })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => (window.__confirmSeen || []).join('\n')), { timeout: 10_000 }).toMatch(/quanti crediti ho/i);
  const visto = await page.evaluate(() => window.__confirmSeen.join('\n'));
  expect(visto).not.toMatch(/luca|moretti/i);
});
