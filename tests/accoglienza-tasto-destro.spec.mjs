// #2096 — il tasto destro sull'intervista di benvenuto: «Salta l'accoglienza» la chiude come il suo tasto, «Riprendi
// dopo» torna alla home lasciandola a metà (il segno «già accolto» non si scrive), e non si riapre da sola qui.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

test.use({ accoglienzaFatta: false });

async function apriIntervista(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null; return !!page; }, { timeout: 10_000 }).toBe(true);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_LESSON]: 'deepseek-flash', [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('preparare la dashboard')) return JSON.stringify({ message: 'Buongiorno.', suggestions: [] });
      if (all.includes('integrare le nuove lezioni') || all.includes('analizzare l')) return 'PROFILO:\n-';
      return JSON.stringify({ text: 'Ciao! Come ti chiami?', actions: [] });
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const text = reply(messages);
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => ({ text: reply(messages), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
  });
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await expect(page.locator('#bubbles .dash-bubble-filo').first()).toBeVisible({ timeout: 15_000 });
  return page;
}

const etichette = (page) => menuDi(page).voci.evaluateAll((vs) => vs.map((v) => v.textContent.trim()));

test('«Riprendi dopo» torna alla home e lascia l’intervista a metà', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await apriIntervista(app, shell);
  await page.locator('#bubbles .dash-bubble-filo').first().click({ button: 'right' });
  const voci = await etichette(page);
  expect(voci).toContain('Salta l’accoglienza');
  expect(voci).toContain('Riprendi dopo');
  await menuDi(page).voce('Riprendi dopo').first().click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 10_000 });
  const s = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding());
  expect(s.done).not.toBe(true);
  // Non si riapre da sola in questa scheda.
  await page.waitForTimeout(1500);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home');
});

test('«Salta l’accoglienza» dal tasto destro la chiude come il suo tasto', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await apriIntervista(app, shell);
  await page.locator('#bubbles .dash-bubble-filo').first().click({ button: 'right' });
  await menuDi(page).voce('Salta l’accoglienza').first().click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 30_000 });
  expect((await app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding())).done).toBe(true);
});
