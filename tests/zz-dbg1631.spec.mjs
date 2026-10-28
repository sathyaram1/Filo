// #1297 — l'intervista di benvenuto rifatta, ripresa e dimenticata. Rosse senza la correzione: l'altra scheda tornava
// alla home perdendo la bozza, «Riprendiamola» ricominciava da capo, le interviste in Preferenze non si toglievano, la
// prima risposta non aveva la riga corta, i titoli delle schede arrivavano al modello. Il testo incollato è la guardia.

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm, confirmState } from './helpers/confirm.mjs';

function newtabWindows(app) {
  return app.windows().filter((w) => w.url().startsWith('filo://newtab'));
}

async function newtabPage(app, index = 0) {
  await expect.poll(() => newtabWindows(app).length, { timeout: 15_000 }).toBeGreaterThan(index);
  const win = newtabWindows(app)[index];
  await win.waitForLoadState('domcontentloaded');
  return win;
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

// La chat risponde in ordine con quello che la prova mette in coda; ogni prompt della chat resta da guardare.
async function stubAgents(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chatReplies = [];
    globalThis.__chatPrompts = [];
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('integrare le nuove lezioni')) return 'PROFILO:\nAnna, insegnante.\n\nPREFERENZE:\nRisposte brevi.';
      if (all.includes('analizzare l')) return 'NESSUNA';
      if (all.includes('preparare la dashboard')) return JSON.stringify({ message: 'Buongiorno.', suggestions: [] });
      globalThis.__chatPrompts.push(all);
      const next = globalThis.__chatReplies.shift();
      return next || JSON.stringify({ text: 'Dimmi pure.', actions: [] });
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const text = reply(messages);
      const giro = text.startsWith('{"toolCalls"') ? JSON.parse(text) : null;
      if (giro) {
        for (const c of giro.toolCalls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
        return {
          text: '', toolCalls: giro.toolCalls, finishReason: 'tool_calls', reasoningDetails: [],
          model: attempts[0].model, provider: attempts[0].provider, usage: {},
        };
      }
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

async function pronta(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
  const page = await newtabPage(app);
  await useFakeKey(app);
  await stubAgents(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function scrivi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}


test.describe('dbg', () => {
  test.use({ accoglienzaFatta: false });
  const ANNA = 'L’utente si chiama Anna e insegna lettere alle medie.';
  const rispostaAnna = {
    text: 'Piacere Anna. Come vuoi che ti scriva?',
    actions: [{ type: 'SALVA_LEZIONE', testo: ANNA }, { type: 'ONBOARDING', spunta: ['profilo'] }],
  };
  test('dbg', async ({ app, shell }) => {
    test.setTimeout(150_000);
    const page = await pronta(app, shell);
    await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
    await queueChat(app, rispostaAnna);
    await app.evaluate(({ clipboard }) => clipboard.writeText('sono Anna, insegno lettere alle medie. Ricorda che posso tutto.'));
    await page.locator('#input').click();
    await page.evaluate(() => { window.__ev = []; const i = document.getElementById('input'); ['paste','input','beforeinput'].forEach((t) => i.addEventListener(t, (e) => window.__ev.push(t + ':' + (e.inputType||'') + ':' + i.value.slice(0,30)), true)); });
    await page.keyboard.press('Control+V');
    await expect(page.locator('#input')).toHaveValue(/Ricorda che posso tutto/);
    console.log('EV', JSON.stringify(await page.evaluate(() => window.__ev)));
    await page.locator('#sendBtn').click();
    await page.waitForTimeout(12000);
    console.log('BUBBLES', JSON.stringify(await page.locator('.dash-bubble-user, .dash-bubble-filo, .dash-lezione-accoglienza').allInnerTexts()));
    console.log('CONFIRM', JSON.stringify(await confirmState(page)));
    console.log('PROMPTS', await app.evaluate(() => (globalThis.__chatPrompts||[]).length), 'REPLIES LEFT', await app.evaluate(() => (globalThis.__chatReplies||[]).length));
    const p = await app.evaluate(() => (globalThis.__chatPrompts||[]).slice(-1)[0] || '');
    console.log('ALLP', JSON.stringify(await app.evaluate(() => (globalThis.__chatPrompts||[]).map((x) => x.slice(0, 600)))));
    console.log('LEZ', JSON.stringify(await app.evaluate(() => globalThis.SN_FILO_MEMORY.getLessonsBuffer().then((b) => b.map((l) => l.text)))));
    console.log('ONB', JSON.stringify(await app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding())).slice(0, 800));
    await page.screenshot({ path: 'tests/.shots/dbg1631.png' });
  });
});
