// Verifica #517 — giro 4, dal punto di vista dell'utente, nella chat della home.
//
//   1. il formato interno lasciato scritto dentro un recinto di tre apici,
//      dopo una frase di preambolo: in chat resta un blocco di codice, la
//      sveglia non c'è, nessun secondo tentativo e nessuna riga che lo dica.
//      È il secondo caso della segnalazione, scritto come lo scrive un modello
//      che i blocchi di codice li recinta sempre;
//   2. il falso allarme sul cammino di chi chiede un testo: l'utente fa
//      riordinare una lista che sta nella chat, Filo gliela riscrive e lo dice
//      col pronome. La risposta già comparsa viene cancellata, rifatta con una
//      seconda chiamata al modello, e poi smentita.
//
// I test sono scritti per essere ROSSI finché la porta è aperta.

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

async function configureModel(app) {
  await app.evaluate(async (_electron) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function installScript(app, script) {
  await app.evaluate(async (_electron, script) => {
    globalThis.__captured = [];
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const step = script[Math.min(i++, script.length - 1)];
      globalThis.__captured.push({ messages: JSON.parse(JSON.stringify(messages)) });
      await new Promise((r) => setTimeout(r, 40));
      for (const c of step.toolCalls || []) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (step.text) { try { onDelta && onDelta(step.text); } catch (_) {} }
      return {
        text: step.text || '', toolCalls: step.toolCalls || [], reasoningDetails: [],
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
  }, script);
}

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
}

test('il formato interno recintato dopo un preambolo non finisce in silenzio', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [{
    text: 'Fatto, ti ho preparato tutto.\n```json\n[{"type":"SVEGLIA","ora":"19:00","etichetta":"stasera"}]\n```',
  }]);
  await chiedi(page, 'mettimi una sveglia alle 19 per stasera');

  // Di sveglie non ne nasce nessuna.
  expect(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).toHaveLength(0);
  // Quindi o il turno torna indietro al modello, o all'utente resta una riga
  // che dice che lì dentro non è successo niente. Oggi non c'è né l'uno né
  // l'altra: in chat resta un blocco di codice e basta.
  const giri = await app.evaluate(() => globalThis.__captured.length);
  const avvisi = await page.locator('.dash-bubble-avviso').count();
  expect(giri > 1 || avvisi > 0).toBe(true);
});

test('la lista riordinata dentro la risposta non viene buttata e poi smentita', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [{
    text: 'burro, latte, pane, uova\n\nTe l\'ho messa in ordine alfabetico.',
  }]);
  await chiedi(page, 'ordinami questa lista: pane, uova, burro, latte');

  // La lista è nella risposta: l'utente la legge. Non c'è nessuno strumento
  // che «mette in ordine alfabetico», quindi non c'è niente da smentire.
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // E la risposta non va cancellata e rifatta: una chiamata al modello, non due.
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(1);
});
