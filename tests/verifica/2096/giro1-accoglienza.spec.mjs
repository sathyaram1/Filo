// Verifica #2096 giro 1: «Riprendi dopo» sull'intervista di benvenuto la ripropone nella scheda nuova dopo.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

test.use({ accoglienzaFatta: false });

async function modello(app) {
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
}

test('«Riprendi dopo»: l\'intervista torna nella scheda nuova successiva', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null; return !!page; }, { timeout: 10_000 }).toBe(true);
  await modello(app);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await expect(page.locator('#bubbles .dash-bubble-filo').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('#bubbles .dash-bubble-filo').first().click({ button: 'right' });
  await menuDi(page).voce('Riprendi dopo').first().click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 10_000 });
  const nuova = await openTab('filo://newtab/');
  await expect(nuova.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await expect(nuova.locator('#bubbles .dash-bubble-filo').first()).toBeVisible({ timeout: 15_000 });
});
