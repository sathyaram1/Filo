// #524 — giro 3, sonde su interazioni fra schede.

import { test, expect } from './fixtures/electron.mjs';

function newtabWindows(app) {
  return app.windows().filter((w) => w.url().startsWith('filo://newtab'));
}
async function newtabPage(app, index = 0) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const wins = newtabWindows(app);
    if (wins.length > index) {
      await wins[index].waitForLoadState('domcontentloaded');
      return wins[index];
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`newtab #${index} non trovata`);
}
async function useFakeKey(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'flash-lite-3',
        [C.ACTIONS.FILO_LESSON]: 'flash-lite-3',
        [C.ACTIONS.FILO_COMPACT]: 'flash-lite-3',
        [C.ACTIONS.FILO_DASHBOARD]: 'flash-lite-3',
      },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
  });
}
async function stubAgents(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chatReplies = [];
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('integrare le nuove lezioni')) return 'PROFILO:\nAnna.\n\nPREFERENZE:\nBrevi.';
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
const queueChat = (app, ...replies) => app.evaluate((_e, rs) => {
  globalThis.__chatReplies = (globalThis.__chatReplies || []).concat(rs);
}, replies.map((r) => JSON.stringify(r)));
const onbState = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding());

// H — utente di vecchia data: sta chiacchierando con Filo in una scheda e
// intanto rilancia l'intervista di benvenuto da Preferenze (o dalla riga sulla
// home). Quando la nuova intervista finisce, la conversazione che aveva aperto
// nell'altra scheda non deve sparire.
test('H — rifare l’intervista non deve cancellare la chat aperta in un’altra scheda', async ({ app, shell, openTab }) => {
  test.setTimeout(180_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const chat = await newtabPage(app);
  await useFakeKey(app);
  await stubAgents(app);
  // Utente già accolto: niente intervista in questa scheda.
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));
  await chat.reload();
  await chat.waitForLoadState('domcontentloaded');
  await expect(chat.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 20_000 });

  // Conversazione normale in corso, con qualcosa che vale la pena non perdere.
  await queueChat(app, { text: 'Ecco la ricetta della carbonara: guanciale, uova, pecorino.', actions: [] });
  await chat.locator('#input').fill('dammi la ricetta della carbonara');
  await chat.locator('#sendBtn').click();
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'carbonara' })).toBeVisible({ timeout: 30_000 });

  // Da Preferenze rilancio l'intervista di benvenuto: si apre in una scheda sua.
  const prefs = await openTab('filo://preferences/preferences.html');
  await expect(prefs.locator('#restartOnboarding')).toBeVisible({ timeout: 15_000 });
  await prefs.locator('#restartOnboarding').click();
  const onb = await newtabPage(app, 1);
  await expect(onb.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });

  // La chat dell'altra scheda è ancora lì mentre l'intervista è in corso.
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'carbonara' })).toBeVisible();

  // Chiudo l'intervista con la sua via d'uscita.
  await onb.locator('#skipOnboarding').click();
  await expect(onb.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 40_000 });
  await chat.waitForTimeout(2000);

  console.log('[H] stato scheda-chat dopo la chiusura:', await chat.evaluate(() => document.body.dataset.state));
  console.log('[H] bolle rimaste:', await chat.evaluate(() => document.querySelectorAll('#bubbles .dash-bubble').length));
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'carbonara' })).toBeVisible();
});
