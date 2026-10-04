// #949 giro 6, rilievo 2 — dopo l'OK, il pulsante del cambio confermato non dice più «Filo vuole impostare»: è fatto.

import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, confirmState } from '../../helpers/confirm.mjs';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
    });
  });
}

async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      const text = giro.text || '';
      if (text) { try { onDelta && onDelta(text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const imposta = (chiave, valore, id = 'i1') => ({
  toolCalls: [{ id, name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave, valore }) }],
});
async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('dopo l\'OK il pulsante dice che il blocco della pubblicità è spento, non che Filo vuole spegnerlo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [imposta('blocco_pubblicita', false), { text: 'Ti chiedo conferma.' }]);
  await scrivi(chat, 'spegni il blocco della pubblicità');
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 10_000 }).toContain('Blocco di pubblicità e tracker');
  await clickConfirm(chat, 'ok');
  await expect.poll(async () => (await impostazioni(app)).security.adblock.enabled, { timeout: 5_000 }).toBe(false);
  const bolla = chat.locator('.dash-bubble-filo', { hasText: 'Ti chiedo conferma.' });
  const chip = bolla.locator('button', { hasText: 'Blocco di pubblicità' });
  await expect(chip).toContainText('✓', { timeout: 5_000 });
  await chat.screenshot({ path: 'tests/.shots/verifica-949-giro6-chip.png' });
  await expect(chip).not.toContainText('vuole');
});
