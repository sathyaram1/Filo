// Verifica #2578 giro 1: l'intervista di benvenuto non riparte in incognito per chi è già stato accolto.

import { test, expect } from '../../fixtures/electron.mjs';

async function home(app, tranne = []) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return !tranne.includes(x) && x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

const manda = (page, msg) => page.evaluate((m) => new Promise((ok) => chrome.runtime.sendMessage(m, (r) => ok(r))), msg);
const statoIncognito = (app) => app.evaluate(() => globalThis.__filoStorage.runIncognito(() => globalThis.SN_FILO_MEMORY.getOnboarding()));

async function modelloPronto(app) {
  await app.evaluate(async () => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chiamate = 0;
    const risposta = (attempts, messages) => {
      globalThis.__chiamate += 1;
      const tutto = JSON.stringify(messages || []);
      const text = tutto.includes('preparare la dashboard') ? JSON.stringify({ message: 'Eccoci.', suggestions: [] }) : 'Dimmi pure.';
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = risposta(attempts, messages);
      try { onDelta && onDelta(r.text); } catch (_) {}
      return r;
    };
    P.completeWithFallback = async ({ attempts, messages }) => risposta(attempts, messages);
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' } });
  });
}

test.describe('accolto prima di #524', () => {
  test.use({ accoglienzaFatta: true });

  test('chi ha solo il segno vecchio di accoglienza non rivede l\'intervista in incognito', async ({ app, shell }) => {
    test.setTimeout(60_000);
    const page = await home(app);
    await app.evaluate(async () => {
      await globalThis.__filoStorage.remove(['filo_onboarding']);
      await globalThis.__filoStorage.set({ filo_welcomed: true });
    });
    expect((await app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding())).done).toBe(true);
    await modelloPronto(app);
    await shell.evaluate(() => window.filoShell.openIncognito());
    const inc = await home(app, [page]);
    await expect(inc.locator('#input')).toBeVisible({ timeout: 15_000 });
    await expect(inc.locator('.dash-bubble-filo', { hasText: 'Ciao, sono Filo' })).toHaveCount(0);
    expect((await statoIncognito(app)).done).toBe(true);
  });
});

test.describe('accolto mentre una finestra incognito era già aperta', () => {
  test.use({ accoglienzaFatta: false });

  test('chiusa l\'intervista nella finestra normale, l\'incognito non la ripropone', async ({ app, shell }) => {
    test.setTimeout(90_000);
    const page = await home(app);
    await modelloPronto(app);
    await page.reload();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ciao, sono Filo' })).toBeVisible({ timeout: 15_000 });

    await shell.evaluate(() => window.filoShell.openIncognito());
    const inc = await home(app, [page]);
    await expect(inc.locator('#input')).toBeVisible({ timeout: 15_000 });

    // L'utente chiude l'accoglienza nella finestra normale: da qui in poi è accolto.
    const r = await manda(page, { type: 'filo_close_onboarding' });
    expect(r && r.ok).toBe(true);
    expect((await app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding())).done).toBe(true);

    await inc.reload();
    await expect(inc.locator('#input')).toBeVisible({ timeout: 15_000 });
    expect((await statoIncognito(app)).done).toBe(true);
    await expect(inc.locator('.dash-bubble-filo', { hasText: 'Ciao, sono Filo' })).toHaveCount(0);
  });
});
