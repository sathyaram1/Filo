// #592 giro 17 — il popup che si apre mentre l'utente scrive in chat non deve
// fargli perdere la frase: chiuso il popup, si riprende a scrivere dov'era.
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

test('#592 g17 — chiuso il popup, quello che si stava scrivendo in chat riprende nel campo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__g17b_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const sys = (messages.find((m) => m.role === 'system') || {}).content || '';
      if (!String(sys).includes('═══ CONTENUTO ESTERNO ═══')) return { ...base, text: 'NULLA DA IMPARARE', toolCalls: [], finishReason: 'stop' };
      n += 1;
      await new Promise((r) => setTimeout(r, 800));
      if (n === 1) return { ...base, text: '', finishReason: 'tool_calls',
        toolCalls: [{ id: 's1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'stile_agente', valore: 'Rispondi breve.' }) }] };
      return { ...base, text: 'Fatto.', toolCalls: [], finishReason: 'stop' };
    };
  });
  await page.locator('#input').fill('scrivimi breve');
  await page.locator('#sendBtn').click();
  await page.locator('#input').focus();
  await page.keyboard.type('e poi dimmi che tempo fa', { delay: 20 });
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await clickConfirm(page, 'ok');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0, { timeout: 5_000 });
  await page.keyboard.type(' domani', { delay: 20 });
  const campo = await page.locator('#input').inputValue();
  const attivo = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  expect(attivo, 'dopo il popup il fuoco non torna al campo della chat').toBe('input');
  expect(campo.endsWith(' domani')).toBe(true);
  await app.evaluate(() => { try { globalThis.__g17b_restore?.(); } catch (_) {} });
});
