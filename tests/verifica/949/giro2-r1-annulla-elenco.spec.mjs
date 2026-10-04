// Giro 2, rilievo 1: annullare un sito aggiunto dalla chat a un elenco toglie anche i siti
// aggiunti dopo. «blocca a.it», poi «blocca b.it», poi annulla dal segno del primo: deve restare b.it.
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

const blacklist = async (app) => (await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).security.siteBlock.blacklist;

test('annullare «blocca a.it» non toglie b.it, bloccato dopo', async ({ app, shell }) => {
  test.setTimeout(90_000);
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
      const sito = n === 1 ? 'a.it' : (n === 3 ? 'b.it' : '');
      const calls = sito ? [{ id: `i${n}`, name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'siti_bloccati', valore: `aggiungi ${sito}` }) }] : [];
      const text = sito ? '' : 'Fatto.';
      if (text) onDelta && onDelta(text);
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  });

  for (const [testo, atteso] of [['blocca a.it', ['a.it']], ['blocca b.it', ['a.it', 'b.it']]]) {
    await chat.bringToFront();
    await chat.locator('#input').fill(testo);
    await chat.locator('#sendBtn').click();
    await clickConfirm(chat, 'ok', { timeout: 10_000 });
    await expect.poll(() => blacklist(app), { timeout: 5_000 }).toEqual(atteso);
    await expect(chat.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toHaveCount(atteso.length, { timeout: 10_000 });
  }

  const bolla = chat.locator('.dash-bubble-user', { hasText: 'blocca a.it' });
  const segno = bolla.locator('.dash-cambi-segno');
  await expect(segno).toBeVisible({ timeout: 5_000 });
  await segno.hover();
  const pop = bolla.locator('.dash-cambi-pop');
  await expect(pop).toContainText('aggiunto a.it');
  await pop.locator('.dash-cambi-annulla').click();
  await expect.poll(() => blacklist(app), { timeout: 5_000 }).toEqual(['b.it']);
});
