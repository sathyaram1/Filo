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

async function preparaModello(app) {
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
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chatReplies = [];
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('integrare le nuove lezioni')) return 'PROFILO:\nAnna.\n\nPREFERENZE:\nBreve.';
      if (all.includes('analizzare l')) return 'LEZIONE: Anna.';
      if (all.includes('preparare la dashboard')) return JSON.stringify({ message: 'Buongiorno Anna.', suggestions: [] });
      return globalThis.__chatReplies.shift() || JSON.stringify({ text: 'Dimmi pure.', actions: [] });
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const text = reply(messages);
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => ({ text: reply(messages), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
  });
}

const queueChat = (app, ...replies) => app.evaluate((_electron, rs) => {
  globalThis.__chatReplies = (globalThis.__chatReplies || []).concat(rs);
}, replies.map((r) => JSON.stringify(r)));
const onbState = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding());
const livelloSalvato = (app) => app.evaluate(() => globalThis.SN_STORAGE.getSettings().then((s) => (s.autonomia || {}).livello || ''));

async function apriIntervistaQuasiFinita(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await preparaModello(app);
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    const O = globalThis.SN_ONBOARDING;
    await M.setOnboarding(O.tick(await M.getOnboarding(), O.ITEM_IDS.filter((id) => id !== 'autonomia')).state);
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  return page;
}

async function rispondiEAspettaScelta(page) {
  await page.locator('#input').fill('sono Anna');
  await page.locator('#sendBtn').click();
  const scelta = page.locator('.dash-bubble-filo .dash-autonomia-scelta');
  await expect(scelta).toBeVisible({ timeout: 30_000 });
  return scelta;
}


test('debug segs', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervistaQuasiFinita(app, shell);
  await page.evaluate(() => { window.__ev = []; window.filo.onAction((d) => window.__ev.push({ kind: d.kind, type: d.type || (d.action && d.action.type), kept: d.kept })); });
  await page.evaluate(() => {
    window.__stacks = [];
    const d = Object.getOwnPropertyDescriptor(Element.prototype, 'className');
    Object.defineProperty(Element.prototype, 'className', { configurable: true, get() { return d.get.call(this); }, set(v) { if (v === 'dash-activity-seg') window.__stacks.push(new Error().stack); d.set.call(this, v); } });
  });
  await queueChat(app, { text: 'Quanto vuoi che faccia da solo?', actions: [{ type: 'ONBOARDING', autonomia: true }] });
  await rispondiEAspettaScelta(page);
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => ({ stacks: window.__stacks, ev: window.__ev, segs: [...document.querySelectorAll('.dash-activity').values()].pop().querySelectorAll('.dash-activity-seg').length, html: [...document.querySelectorAll('.dash-activity-seg')].map((s) => s.dataset.stato + ' | ' + s.textContent) }));
  console.log(JSON.stringify(info, null, 1));
});

test('debug timer', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervistaQuasiFinita(app, shell);
  await page.evaluate(() => { window.__ev = []; window.filo.onAction((d) => window.__ev.push({ kind: d.kind, type: d.type || (d.action && d.action.type), kept: d.kept, risposta: d.risposta })); });
  await queueChat(app, { text: 'Fatto, timer da 5 minuti.', actions: [{ type: 'TIMER', minuti: 5, etichetta: 'pasta' }] });
  await page.locator('#input').fill('timer 5 minuti');
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(5000);
  const info = await page.evaluate(() => ({ ev: window.__ev, html: [...document.querySelectorAll('.dash-activity-seg')].map((s) => s.dataset.stato + ' | ' + s.textContent) }));
  console.log(JSON.stringify(info, null, 1));
});
