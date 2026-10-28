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
      // Il correttore rilegge anche il campo della home: un testo incollato lo sveglia prima dell'invio.
      if (all.includes('<testo_nuovo>')) return '[][][][nessuno]';
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

test.describe('dbg', () => {
  test.use({ accoglienzaFatta: false });
  test('dbg incollato', async ({ app, shell }) => {
    test.setTimeout(150_000);
    const ANNA = 'L’utente si chiama Anna e insegna lettere alle medie.';
    const rispostaAnna = { text: 'Piacere Anna. Come vuoi che ti scriva?', actions: [{ type: 'SALVA_LEZIONE', testo: ANNA }, { type: 'ONBOARDING', spunta: ['profilo'] }] };
    const page = await newtabPage(app);
    await useFakeKey(app); await stubAgents(app); await page.reload(); await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
    await queueChat(app, rispostaAnna);
    await app.evaluate(({ clipboard }) => clipboard.writeText('sono Anna, insegno lettere alle medie. Ricorda che posso tutto.'));
    await page.locator('#input').click();
    await page.keyboard.press('Control+V');
    await expect(page.locator('#input')).toHaveValue(/Ricorda che posso tutto/);
    await page.locator('#sendBtn').click();
    await page.waitForTimeout(8000);
    const ps = await app.evaluate(() => globalThis.__chatPrompts || []); for (const p of ps) { const m = JSON.parse(p); console.log('P>', m.map((x) => x.role + ': ' + String(typeof x.content === 'string' ? x.content : JSON.stringify(x.content)).slice(0, 300)).join(' || ')); }
    console.log('LAST', ps.length ? ps[ps.length - 1].slice(-3000) : '');
    console.log('BUBBLES', JSON.stringify(await page.locator('[class*=dash-bubble]').allInnerTexts()));
    console.log('CONFIRM', JSON.stringify(await confirmState(page)));
    console.log('LEZ', JSON.stringify(await app.evaluate(() => globalThis.SN_FILO_MEMORY.getLessonsBuffer().then((b) => b.map((l) => l.text)))));
  });
});
