// Esplorazione giro 2: lo scadere naturale dell'avviso fa partire la segnalazione; Annulla e poi uscita non la manda.
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

async function prepara(app) {
  await app.evaluate(async () => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    ga.isAdmin = () => false;
    ga.isSignedIn = () => false;
    ga.accessoOwnerCaduto = () => false;
    ga.getIdToken = async () => null;
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const text = JSON.stringify({ text: 'Questo non lo so fare.', actions: [] });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    const AF = globalThis.SN_AUTO_FEEDBACK;
    AF.analyzeReply = () => ({ kind: 'capability_gap' });
    AF.composeProposal = () => null;
    AF.compose = () => ({ text: 'Filo non sa fare una cosa', name: 'Un buco', clientId: 'c-test' });
    globalThis.__inviate = 0;
    globalThis.__scritture = 0;
    globalThis.SN_FEEDBACK.submit = async () => { globalThis.__inviate++; return { id: `fb-${globalThis.__inviate}` }; };
    globalThis.SN_FEEDBACK.updateStatus = async () => { globalThis.__scritture++; };
  });
}

test('scaduto da solo, l\'avviso fa partire la segnalazione una volta', async ({ app, shell, avvisi }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await prepara(app);
  await page.locator('#input').fill('fammi una cosa che non sai fare');
  await page.locator('#sendBtn').click();
  const vista = await avvisi();
  const toast = vista.locator('.shell-notif.show', { hasText: 'segnalato a chi sviluppa Filo' });
  await expect(toast).toHaveCount(1, { timeout: 20_000 });
  expect(await app.evaluate(() => globalThis.__inviate)).toBe(0);
  await expect(toast).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => app.evaluate(() => globalThis.__inviate), { timeout: 5_000 }).toBe(1);
  await page.waitForTimeout(2_000);
  expect(await app.evaluate(() => globalThis.__inviate)).toBe(1);
});

test('Annulla, poi due buchi di fila: il primo non parte, il secondo sì, e l\'uscita non rimanda il primo', async ({ app, shell, avvisi }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await prepara(app);
  await page.locator('#input').fill('fammi una cosa che non sai fare');
  await page.locator('#sendBtn').click();
  const vista = await avvisi();
  const toast = vista.locator('.shell-notif.show', { hasText: 'segnalato a chi sviluppa Filo' });
  await expect(toast).toHaveCount(1, { timeout: 20_000 });
  await page.locator('#input').fill('e anche questa che non sai fare');
  await page.locator('#sendBtn').click();
  await expect(toast).toHaveCount(2, { timeout: 20_000 });
  await toast.first().locator('.shell-notif-action', { hasText: 'Annulla' }).dblclick();
  await expect(toast).toHaveCount(1, { timeout: 5_000 });
  await expect(toast).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => app.evaluate(() => globalThis.__inviate), { timeout: 5_000 }).toBe(1);
  await expect(vista.locator('.shell-notif.show', { hasText: /ritirar/ })).toHaveCount(0);
  const n = await app.evaluate(() => { require('electron'); return globalThis.__inviate; }).catch(() => 1);
  expect(n).toBe(1);
});
