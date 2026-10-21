// Verifica #1297, giro 4: r1 l'intervista rifatta a metà prende il posto della conversazione chiesta (ricarica,
// collegamento diretto); r2 la home già aperta offre ancora «Riprendiamola» dopo la × in Preferenze.

import { test, expect } from '../../fixtures/electron.mjs';

const newtabWindows = (app) => app.windows().filter((w) => w.url().startsWith('filo://newtab'));
async function newtabPage(app, index = 0) {
  await expect.poll(() => newtabWindows(app).length, { timeout: 15_000 }).toBeGreaterThan(index);
  const win = newtabWindows(app)[index];
  await win.waitForLoadState('domcontentloaded');
  return win;
}

async function prepara(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
  const page = await newtabPage(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_LESSON]: 'deepseek-flash', [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chatReplies = [];
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('integrare le nuove lezioni')) return 'PROFILO:\nAnna.\n\nPREFERENZE:\nBreve.';
      if (all.includes('analizzare l')) return 'NESSUNA';
      if (all.includes('preparare la dashboard')) return JSON.stringify({ message: 'Buongiorno.', suggestions: [] });
      return globalThis.__chatReplies.shift() || JSON.stringify({ text: 'Dimmi pure.', actions: [] });
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const text = reply(messages);
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => ({ text: reply(messages), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  return page;
}
const coda = (app, ...rs) => app.evaluate((_e, x) => { globalThis.__chatReplies.push(...x); }, rs.map((r) => JSON.stringify(r)));
async function scrivi(page, t) { await page.locator('#input').fill(t); await page.locator('#sendBtn').click(); }

async function carbonara(app, shell) {
  const page = await prepara(app, shell);
  await coda(app, { text: 'Guanciale, uova, pecorino e pepe.', actions: [] });
  await scrivi(page, 'dammi la ricetta della carbonara');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Guanciale, uova' })).toBeVisible({ timeout: 30_000 });
  return page;
}

async function rifaiDaPreferenze(app, shell, openTab) {
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.locator('#restartOnboarding').click();
  const intervista = await newtabPage(app, 1);
  await expect(intervista.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await shell.locator('.tab').first().click();
  return intervista;
}

test('r1 ricaricata, la scheda della carbonara resta la carbonara anche con l’intervista rifatta aperta', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  const carb = await carbonara(app, shell);
  await rifaiDaPreferenze(app, shell, openTab);
  await carb.reload();
  await carb.waitForLoadState('domcontentloaded');
  await carb.waitForTimeout(3_000);
  await expect(carb.locator('.dash-bubble-filo', { hasText: 'Ciao, sono Filo' })).toHaveCount(0);
  await expect(carb.locator('.dash-bubble', { hasText: 'Guanciale, uova' }).first()).toBeVisible();
});

test('r1 il collegamento diretto alla carbonara apre la carbonara anche con l’intervista rifatta aperta', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  await carbonara(app, shell);
  const id = await app.evaluate(async () => (await globalThis.SN_FILO_CHATS.list()).find((c) => JSON.stringify(c.messages || []).includes('carbonara')).id);
  await rifaiDaPreferenze(app, shell, openTab);
  const link = await openTab(`filo://newtab/?chat=${encodeURIComponent(id)}`);
  await link.waitForTimeout(3_000);
  await expect(link.locator('.dash-bubble-filo', { hasText: 'Ciao, sono Filo' })).toHaveCount(0);
  await expect(link.locator('.dash-bubble-filo', { hasText: 'Guanciale, uova' })).toBeVisible();
});

test.describe('utente nuovo', () => {
  test.use({ accoglienzaFatta: false });
  test('tolta con la × l’intervista chiusa a metà, la home già aperta non offre più di riprenderla', async ({ app, shell, openTab }) => {
    test.setTimeout(150_000);
    const page = await prepara(app, shell);
    await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
    await coda(app, { text: 'Piacere Anna. Come vuoi che ti scriva?', actions: [{ type: 'ONBOARDING', spunta: ['profilo'] }] });
    await scrivi(page, 'sono Anna, insegno lettere');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Come vuoi che ti scriva' })).toBeVisible({ timeout: 30_000 });
    await scrivi(page, 'basta così');
    await expect(page.locator('#onbNoticeRedo')).toBeVisible({ timeout: 30_000 });
    const prefs = await openTab('filo://preferences/preferences.html');
    await expect(prefs.locator('.onb-conv')).toHaveCount(1, { timeout: 10_000 });
    await prefs.locator('.onb-conv .onb-via').click();
    await expect(prefs.locator('.onb-conv')).toHaveCount(0);
    await shell.locator('.tab').first().click();
    await page.waitForTimeout(2_000);
    await expect(page.locator('#onbNoticeRedo')).toBeHidden();
  });
});
