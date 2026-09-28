// #592, giro 15 — rilievo 2: «dimentica» toglie le righe che il popup ha
// mostrato, non quelle che la stessa frase trova al momento dell'OK.

import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, confirmState, CONFIRM_HOST } from '../../helpers/confirm.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configureModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
  });
}

async function fakeProvider(app, giri) {
  await app.evaluate(async (_electron, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__d_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const sys = (messages.find((m) => m.role === 'system') || {}).content || '';
      if (!String(sys).includes('═══ CONTENUTO ESTERNO ═══')) {
        return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: 'NULLA DA IMPARARE', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      }
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [],
        finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}

test('la memoria cambia mentre il popup di «dimentica» è aperto: l’OK toglie solo le righe mostrate', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.setMemory({ PROFILO: 'Si chiama Marta', PREFERENZE: '' });
    await M.appendLesson('L’utente non beve caffè.');
  });

  await fakeProvider(app, [
    { toolCalls: [{ id: 'd1', name: 'DIMENTICA', arguments: JSON.stringify({ testo: 'caffè' }) }] },
    { text: 'Te lo faccio confermare.' },
  ]);
  await page.locator('#input').fill('dimentica la storia del caffè');
  await page.locator('#sendBtn').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  const popup = (await confirmState(page)).text;
  expect(popup).toContain('L’utente non beve caffè.');

  // Mentre il popup è aperto arrivano altre righe che contengono la stessa
  // parola (una lezione scritta da un'altra scheda, un riordino della memoria).
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.appendLesson('Al bar ordina un caffè d’orzo per la madre.');
    await M.appendLesson('Il caffè della macchinetta in ufficio lo paga Luca.');
    await M.appendLesson('Il martedì porta il caffè ai colleghi.');
  });
  expect(popup).not.toContain('orzo');

  await clickConfirm(page, 'ok');
  await page.waitForTimeout(800);
  const rimaste = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getLessonsBuffer().then((b) => b.map((l) => l.text)));
  expect(rimaste, 'l’OK a una riga ha tolto anche righe che il popup non mostrava').toEqual([
    'Al bar ordina un caffè d’orzo per la madre.',
    'Il caffè della macchinetta in ufficio lo paga Luca.',
    'Il martedì porta il caffè ai colleghi.',
  ]);
  await app.evaluate(() => { try { globalThis.__d_restore?.(); } catch (_) {} });
});
