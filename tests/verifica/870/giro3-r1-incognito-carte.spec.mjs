// #870 giro 3, rilievo 1: quello che succede in una finestra incognito non arriva alle carte della finestra normale:
// né la domanda che Filo sta elaborando, né una carta tolta (che lì non resta e poi ricompare).
import { test, expect } from '../../fixtures/electron.mjs';

async function home(app, escludi = []) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith('filo://newtab') && !escludi.includes(x); } catch (_) { return false; } });
    if (w) {
      await w.waitForLoadState('domcontentloaded');
      await expect(w.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
      return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

async function incognito(app, shell, normale) {
  await shell.evaluate(() => window.filoShell.openIncognito());
  const inc = await home(app, [normale]);
  const davvero = await app.evaluate(({ webContents, session }) => webContents.getAllWebContents()
    .filter((wc) => wc.getURL().startsWith('filo://newtab') && wc.session !== session.defaultSession).length);
  expect(davvero, 'la seconda home non è nella finestra incognito').toBe(1);
  return inc;
}

test('la domanda fatta in incognito non compare fra le carte della finestra normale', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const normale = await home(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await chrome.storage.local.set({ filo_onboarding: { done: true } });
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      await new Promise((ok) => setTimeout(ok, 12_000));
      try { onDelta && onDelta('Ecco.'); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [], text: 'Ecco.', toolCalls: [], finishReason: 'stop' };
    };
  });
  const inc = await incognito(app, shell, normale);
  await inc.locator('#input').fill('sintomi della malattia di cui non voglio si sappia');
  await inc.locator('#sendBtn').click();
  await normale.waitForTimeout(5_000);
  await expect(normale.locator('#accade')).not.toContainText('sintomi della malattia');
  await expect(normale.locator('#accade .dash-carta[data-tipo="lavoro"]')).toHaveCount(0);
});

test('una carta tolta in incognito non sparisce dalla finestra normale', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const normale = await home(app);
  const inc = await incognito(app, shell, normale);
  await inc.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await inc.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(inc.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  await normale.waitForTimeout(1_000);
  await expect(normale.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(1);
});
