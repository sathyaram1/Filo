import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, restore, chiedi } from './aiuto.mjs';
const EVENTO = '{"titolo":"Cena con Anna","data":"2026-10-02","ora":"20:30","durata_min":90,"luogo":"Da Mario"}';
test('dbg', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(({ shell: sh }) => { sh.openPath = async () => ''; });
  await app.evaluate(async (_e, EV) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__dbg_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__dbg = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__dbg.push(JSON.stringify(messages.map((m) => ({ r: m.role, c: String(m.content).slice(-600) }))));
      n += 1;
      const calls = n === 1 ? [{ id: 'd', name: 'EVENTO_CALENDARIO', arguments: EV }] : [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      const text = calls.length ? '' : 'Rispondo.';
      if (text) { try { onDelta && onDelta(text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, EVENTO);
  await chiedi(page, 'segnami la cena con Anna venerdi alle 20:30');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Rispondo.' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' }).click();
  await expect(page.locator('.dash-action-btn', { hasText: 'Aperto nel calendario' })).toBeVisible({ timeout: 10_000 });
  await app.evaluate(() => { globalThis.__dbg = []; });
  await chiedi(page, 'l\'hai aggiunto al calendario?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Rispondo.' }).nth(1)).toBeVisible({ timeout: 10_000 });
  const v = await app.evaluate(() => (globalThis.__dbg || []).join('\n'));
  console.log('>>>DBG>>>', v.slice(0, 4000));
});
