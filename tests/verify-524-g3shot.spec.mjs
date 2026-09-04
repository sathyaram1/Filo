// #524 — giro 3: catture visive (tema chiaro e scuro).
import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app, index = 0) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const wins = app.windows().filter((w) => w.url().startsWith('filo://newtab'));
    if (wins.length > index) { await wins[index].waitForLoadState('domcontentloaded'); return wins[index]; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}
async function setup(app, theme) {
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      theme: t,
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'flash-lite-3', [C.ACTIONS.FILO_LESSON]: 'flash-lite-3',
        [C.ACTIONS.FILO_COMPACT]: 'flash-lite-3', [C.ACTIONS.FILO_DASHBOARD]: 'flash-lite-3',
      },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chatReplies = [];
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('integrare le nuove lezioni')) return 'PROFILO:\nAnna.\n\nPREFERENZE:\nBrevi.';
      if (all.includes('analizzare l')) return 'LEZIONE: Anna.';
      if (all.includes('preparare la dashboard')) return JSON.stringify({ message: 'Buongiorno Anna.', suggestions: [] });
      return globalThis.__chatReplies.shift() || JSON.stringify({ text: 'Dimmi pure.', actions: [] });
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const text = reply(messages); try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => {
      const text = reply(messages);
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, theme);
}

for (const theme of ['light', 'dark']) {
  test(`shot ${theme}`, async ({ app, shell, openTab }) => {
    test.setTimeout(150_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
    const page = await newtabPage(app);
    await setup(app, theme);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });

    await app.evaluate((_e, t) => {
      globalThis.__chatReplies.push(JSON.stringify({
        text: 'Piacere Anna. Ti scrivo breve allora. A proposito: l’aspetto lo cambi parlando — se preferisci il tema scuro, dimmelo.',
        actions: [{ type: 'ONBOARDING', spunta: ['profilo', 'stile'] }],
      }));
    }, theme);
    await page.locator('#input').fill('sono Anna, insegno lettere alle medie; scrivimi breve e dammi del tu');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `tests/.shots/524-g3-intervista-${theme}.png` });

    await page.locator('#skipOnboarding').click();
    await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 40_000 });
    await expect(page.locator('#onbNotice')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/524-g3-home-riga-${theme}.png` });

    const prefs = await openTab('filo://preferences/preferences.html');
    await prefs.waitForTimeout(1200);
    await prefs.locator('#restartOnboarding').scrollIntoViewIfNeeded().catch(() => {});
    await prefs.waitForTimeout(400);
    await prefs.screenshot({ path: `tests/.shots/524-g3-preferenze-${theme}.png` });
  });
}
