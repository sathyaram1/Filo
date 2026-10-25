// #892.1 giro 4 — una / seguita da una frase la cui prima parola ha un apostrofo o la punteggiatura attaccata
// («cos'è», «ciao,», «perché?») non è un programma: deve arrivare a Filo, non alla shell.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';

async function newtabPage(app) {
  let win = null;
  await expect.poll(() => {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    return Boolean(win);
  }, { timeout: 10_000 }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => win.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
  return win;
}

async function modelloFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiesto892g4 = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const ultimo = [...(messages || [])].reverse().find((m) => m && m.role === 'user');
      globalThis.__chiesto892g4.push(typeof ultimo?.content === 'string' ? ultimo.content : JSON.stringify(ultimo?.content || ''));
      const text = `Risposta ${globalThis.__chiesto892g4.length} di Filo.`;
      try { onDelta && onDelta(text); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
}

for (const [i, frase] of ["/cos'è un terminale?", '/ciao, come stai?', '/perché?'].entries()) {
  test(`r1 «${frase}» arriva a Filo come messaggio, senza domande e senza shell`, async ({ app }) => {
    const page = await newtabPage(app);
    await modelloFinto(app);
    await page.locator('#input').fill(frase);
    await page.locator('#input').press('Enter');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta 1 di Filo.' }), 'la frase arriva a Filo').toBeVisible({ timeout: 15_000 });
    await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
    await expect(page.locator('.dash-term-cmd'), 'niente è andato alla shell').toHaveCount(0);
    const chiesto = await app.evaluate(() => globalThis.__chiesto892g4);
    expect(chiesto[0]).toContain(frase.slice(1, 6));
    await page.screenshot({ path: `tests/.shots/892-1-g4-r1-${i}.png` }).catch(() => {});
  });
}
