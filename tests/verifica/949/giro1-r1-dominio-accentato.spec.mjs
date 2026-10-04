// Giro 1, rilievo 1: un dominio con lettere accentate che la pagina Sicurezza accetta
// la chat lo rifiuta. «blocca münchen.de» chiesto a Filo deve finire nell'elenco come dalla pagina.
import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

async function homeDi(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab') && !w.url().includes('incognito'); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

test('«blocca münchen.de» dalla chat aggiunge il sito come fa la pagina Sicurezza', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry, theme: 'light',
    });
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      n += 1;
      const calls = n === 1 ? [{ id: 'i1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'siti_bloccati', valore: 'aggiungi münchen.de' }) }] : [];
      const text = n === 1 ? '' : 'Ecco.';
      if (text) onDelta && onDelta(text);
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  });

  // Dalla pagina lo stesso sito entra nell'elenco.
  const sec = await openTab('filo://security/security.html');
  const casella = sec.locator('#sec-siteblock-blacklist');
  await expect(casella).toBeVisible({ timeout: 8_000 });
  await casella.fill('münchen.de');
  await casella.blur();
  await expect.poll(async () => (await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).security.siteBlock.blacklist, { timeout: 5_000 })
    .toEqual(['xn--mnchen-3ya.de']);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ security: { siteBlock: { blacklist: [] } } }));

  // Dalla chat deve fare lo stesso.
  await chat.bringToFront();
  await chat.locator('#input').fill('blocca münchen.de');
  await chat.locator('#sendBtn').click();
  await clickConfirm(chat, 'ok', { timeout: 10_000 });
  await expect.poll(async () => (await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).security.siteBlock.blacklist, { timeout: 5_000 })
    .toEqual(['xn--mnchen-3ya.de']);
});
