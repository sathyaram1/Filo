// #1188 giro 1 — r1: la scelta dell'autonomia sparisce se Filo spunta o chiude con un'altra azione nella stessa risposta;
// r2: il blocco di attività dice «Non partita» sotto una riga che è partita (scelta dell'autonomia, stile).
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';

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

test('r1 la scelta resta a schermo anche se Filo, nella stessa risposta, spunta la voce con un’altra azione', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervistaQuasiFinita(app, shell);
  await queueChat(app, {
    text: 'Ultima cosa: quanto vuoi che faccia da solo? Scegli qui sotto.',
    actions: [{ type: 'ONBOARDING', autonomia: true }, { type: 'ONBOARDING', spunta: ['autonomia'] }],
  });
  await rispondiEAspettaScelta(page);
  await page.waitForTimeout(4000);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread');
  await expect(page.locator('.dash-autonomia-scelta')).toBeVisible();
  expect((await onbState(app)).done).toBe(false);
});

test('r1 la scelta resta a schermo anche se Filo, nella stessa risposta, chiude l’intervista con un’altra azione', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervistaQuasiFinita(app, shell);
  await queueChat(app, {
    text: 'Ultima cosa: quanto vuoi che faccia da solo? Scegli qui sotto.',
    actions: [{ type: 'ONBOARDING', autonomia: true }, { type: 'ONBOARDING', fine: true }],
  });
  await rispondiEAspettaScelta(page);
  await page.waitForTimeout(4000);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread');
  await expect(page.locator('.dash-autonomia-scelta')).toBeVisible();
  expect((await onbState(app)).done).toBe(false);
});

test('r2 sotto la scelta dell’autonomia il blocco di attività non dice «Non partita»', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervistaQuasiFinita(app, shell);
  await queueChat(app, { text: 'Quanto vuoi che faccia da solo?', actions: [{ type: 'ONBOARDING', autonomia: true }] });
  await rispondiEAspettaScelta(page);
  await page.waitForTimeout(1500);
  await expect(page.locator('.dash-activity').last()).toContainText('scelta dell’autonomia');
  await expect(page.locator('.dash-activity').last()).not.toContainText('Non partita');
});

test('r2 sotto lo stile impostato nell’accoglienza il blocco di attività non dice «Non partita»', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervistaQuasiFinita(app, shell);
  await queueChat(app, { text: 'Va bene, ti scrivo così.', actions: [{ type: 'IMPOSTA_PREFERENZA', chiave: 'stile_agente', valore: 'Breve, del tu.' }] });
  await page.locator('#input').fill('scrivimi breve');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-stile-accoglienza')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(page.locator('.dash-activity').last()).toContainText('stile dell');
  await page.waitForTimeout(3000);
  expect(await page.locator('.dash-activity').last().textContent()).not.toContain('Non partita');
});
