// #524 — giro 3, ultime due sonde: cosa fa davvero «Riprendiamola», e la riga
// sulla home in una seconda scheda già aperta.

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
async function setup(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
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
      if (all.includes('integrare le nuove lezioni')) return 'PROFILO:\nAnna, insegnante.\n\nPREFERENZE:\nBrevi.';
      if (all.includes('analizzare l')) return 'LEZIONE: Anna insegna.';
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
  });
}
const queueChat = (app, ...replies) => app.evaluate((_e, rs) => {
  globalThis.__chatReplies = (globalThis.__chatReplies || []).concat(rs);
}, replies.map((r) => JSON.stringify(r)));
const onbState = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding());

test('M — «Riprendiamola» richiede quello che ho appena risposto', async ({ app, shell }) => {
  test.setTimeout(180_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await setup(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });

  // Rispondo alla prima domanda: Filo impara chi sono e lo spunta.
  await queueChat(app, {
    text: 'Piacere Anna. Ti scrivo breve.',
    actions: [
      { type: 'IMPOSTA_PREFERENZA', chiave: 'stile_agente', valore: 'Risposte brevi.' },
      { type: 'ONBOARDING', spunta: ['profilo', 'stile'] },
    ],
  });
  await page.locator('#input').fill('sono Anna, insegno lettere alle medie; scrivimi breve');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });
  expect((await onbState(app)).ticked.slice().sort()).toEqual(['profilo', 'stile']);

  // Chiudo a metà: la home mi propone di riprenderla.
  await page.locator('#skipOnboarding').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 40_000 });
  await expect(page.locator('#onbNotice')).toBeVisible({ timeout: 15_000 });
  await page.locator('#onbNoticeRedo').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });

  const dopo = await onbState(app);
  const prima = await page.evaluate(() => document.querySelector('#bubbles .dash-bubble')?.textContent || '');
  console.log('[M] spunte dopo «Riprendiamola»:', JSON.stringify(dopo.ticked));
  console.log('[M] primo messaggio:', JSON.stringify(prima.slice(0, 160)));
  console.log('[M] bolle a schermo:', await page.evaluate(() => document.querySelectorAll('#bubbles .dash-bubble').length));
  // Se «Riprendiamola» riprendesse, le spunte resterebbero e la prima domanda
  // non tornerebbe.
  expect(dopo.ticked).toEqual([]);
  expect(prima).toContain('Chi sei, e a cosa ti serve di solito il computer?');
});

test('N — la riga sulla home tolta in una scheda resta nell’altra', async ({ app, shell }) => {
  test.setTimeout(180_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const a = await newtabPage(app);
  await setup(app);
  await a.reload();
  await a.waitForLoadState('domcontentloaded');
  await expect(a.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });
  await a.locator('#skipOnboarding').click();
  await expect(a.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 40_000 });
  await expect(a.locator('#onbNotice')).toBeVisible({ timeout: 15_000 });

  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  const b = await newtabPage(app, 1);
  await expect(b.locator('#onbNotice')).toBeVisible({ timeout: 20_000 });

  await a.locator('#onbNoticeDismiss').click();
  await expect(a.locator('#onbNotice')).toBeHidden({ timeout: 10_000 });
  await b.waitForTimeout(2500);
  const ancora = await b.evaluate(() => !document.getElementById('onbNotice')?.hidden);
  console.log('[N] la riga è ancora nella seconda scheda:', ancora);
  expect(ancora).toBe(false);
});
