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

async function useFakeKey(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash',
        [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function stubAgents(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chatReplies = [];
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('integrare le nuove lezioni')) return 'PROFILO:\nAnna.\n\nPREFERENZE:\nBreve.';
      if (all.includes('analizzare l')) return 'LEZIONE: Anna.';
      if (all.includes('preparare la dashboard')) return JSON.stringify({ message: 'Buongiorno Anna.', suggestions: [] });
      const next = globalThis.__chatReplies.shift();
      return next || JSON.stringify({ text: 'Dimmi pure.', actions: [] });
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const text = reply(messages);
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => {
      const text = reply(messages);
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

const queueChat = (app, ...replies) => app.evaluate((_electron, rs) => {
  globalThis.__chatReplies = (globalThis.__chatReplies || []).concat(rs);
}, replies.map((r) => JSON.stringify(r)));
const onbState = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding());
const livelloAutonomia = (app) => app.evaluate(() => globalThis.SN_STORAGE.getSettings().then((s) => (s.autonomia || {}).livello || ''));

async function apriIntervista(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await useFakeKey(app);
  await stubAgents(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  return page;
}

async function chiedi(page, app) {
  await queueChat(app, { text: 'Ultima cosa: quanto vuoi che faccia da solo? Scegli qui sotto.', actions: [{ type: 'ONBOARDING', autonomia: true }] });
  await page.locator('#input').fill('sono Anna, insegnante');
  await page.locator('#sendBtn').click();
  const scelta = page.locator('.dash-bubble-filo .dash-autonomia-scelta').last();
  await expect(scelta).toBeVisible({ timeout: 30_000 });
  return scelta;
}

test('esplora: clic sul livello già attivo risponde e chiude; home senza livello', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY; const O = globalThis.SN_ONBOARDING;
    await M.setOnboarding(O.tick(await M.getOnboarding(), O.ITEM_IDS.filter((id) => id !== 'autonomia')).state);
  });
  const scelta = await chiedi(page, app);
  await page.screenshot({ path: 'tests/.shots/1188-g3-scelta.png' });
  await queueChat(app, { text: 'Perfetto, resto così.', actions: [{ type: 'ONBOARDING', spunta: ['autonomia'] }] });
  await scelta.locator('.dash-autonomia-livello', { hasText: 'Normale' }).click();
  await expect(page.locator('.dash-bubble-user').last()).toHaveText('Scelgo Normale.', { timeout: 10_000 });
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 40_000 });
  expect((await onbState(app)).notice).toBe('');
  await expect(page.locator('#dashAutonomia')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/.shots/1188-g3-home.png' });
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/1188-g3-home-scuro.png' });
});

test('esplora: finestra stretta e tema scuro', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs).setContentSize(520, 760));
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' }));
  const scelta = await chiedi(page, app);
  await page.waitForTimeout(800);
  await scelta.locator('.dash-autonomia-livello', { hasText: 'Automatico' }).hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/1188-g3-stretta-scuro.png' });
  const box = await scelta.boundingBox();
  const vp = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
  expect(await livelloAutonomia(app)).toBe('');
});

test('esplora: risposta a parole, poi clic sulla scelta vecchia e su quella nuova', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  const vecchia = await chiedi(page, app);
  await queueChat(app, { text: 'Allora Conservativo fa per te: sceglilo qui sotto.', actions: [{ type: 'ONBOARDING', autonomia: true }] });
  await page.locator('#input').fill('chiedimi sempre prima');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo .dash-autonomia-scelta')).toHaveCount(2, { timeout: 30_000 });
  const nUser = await page.locator('.dash-bubble-user').count();
  await vecchia.locator('.dash-autonomia-livello', { hasText: 'Conservativo' }).click();
  await expect.poll(() => livelloAutonomia(app), { timeout: 10_000 }).toBe('conservativo');
  await page.waitForTimeout(800);
  const dopoVecchia = await page.locator('.dash-bubble-user').count();
  const nuova = page.locator('.dash-bubble-filo .dash-autonomia-scelta').last();
  await expect(nuova.locator('.dash-autonomia-livello.scelto')).toHaveText('Conservativo');
  await queueChat(app, { text: 'Ok.', actions: [{ type: 'ONBOARDING', spunta: ['autonomia'] }] });
  await nuova.locator('.dash-autonomia-livello', { hasText: 'Conservativo' }).click();
  await page.waitForTimeout(1500);
  const dopoNuova = await page.locator('.dash-bubble-user').count();
  console.log('utenti', nUser, dopoVecchia, dopoNuova, JSON.stringify((await onbState(app)).ticked));
  await page.screenshot({ path: 'tests/.shots/1188-g3-due-scelte.png' });
});
