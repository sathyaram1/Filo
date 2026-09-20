// Verifica #517 — giro 1, dal punto di vista dell'utente, con Filo aperto.
//
// Tre porte:
//   1. la risposta buona scritta come PREAMBOLO e chiusa con la chiamata in
//      chiaro: il turno passa intero, la sveglia non c'è e in chat compare il
//      formato interno. Nessun ritentativo, nessun avviso: è il fallimento
//      muto del feedback, sull'altra metà del sintomo.
//   2. il formato interno riconosciuto ma ripetuto: il rimbalzo c'è, e quando
//      fallisce l'utente resta senza una riga che gli dica cos'è successo,
//      mentre la dichiarazione a parole l'avviso ce l'ha.
//   3. Filo apre una cosa con un comando di shell e poi lo racconta: l'utente
//      legge che «non si è aperto niente», e invece il comando è partito.

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

async function configureModel(app, { terminal = false } = {}) {
  await app.evaluate(async (_electron, terminal) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      ...(terminal ? { terminal: { enabled: true } } : {}),
    });
  }, terminal);
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

test('la risposta buona come preambolo, e la chiamata in chiaro in coda', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Ti metto una sveglia alle 19:00 per stasera.\n\nSVEGLIA{"time":"19:00","label":"sera"}' },
  ]);
  await chiedi(page, 'mettimi una sveglia alle 19 per stasera');

  // La sveglia non esiste: la chiamata era testo, non una chiamata.
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers).toHaveLength(0);

  // Il turno è stato rimandato indietro almeno una volta.
  expect(await app.evaluate(() => globalThis.__captured.length)).toBeGreaterThan(1);

  // E all'utente non resta il formato interno scritto in chat.
  await expect(page.locator('.dash-bubble-filo').last()).not.toContainText('SVEGLIA{');
});

test('quando il rimbalzo sul formato fallisce, l\'utente sa comunque che non è successo niente', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // Formato interno riconosciuto (tutta la risposta è la chiamata), e il
  // modello insiste identico: il rimbalzo c'è stato e non è bastato.
  await installScript(app, [{ text: 'SVEGLIA{"time":"19:00","label":"sera"}' }]);
  await chiedi(page, 'mettimi una sveglia alle 19 per stasera');

  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(2);
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers).toHaveLength(0);

  // La dichiarazione a parole, in questa stessa situazione, l'avviso ce l'ha.
  // Qui l'utente legge un blocco di codice e nient'altro.
  await expect(page.locator('.dash-bubble-avviso')).toBeVisible({ timeout: 10_000 });
});

test('un\'apertura fatta con un comando non viene smentita all\'utente', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app, { terminal: true });
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: '{"comando":"echo apro il blocco note"}' }] },
    { text: 'Ho aperto il blocco note.' },
  ]);
  await chiedi(page, 'aprimi il blocco note');

  // Il comando è partito davvero: è nel diario del lavoro del turno.
  const eseguite = await app.evaluate(() => (globalThis.__captured.length));
  expect(eseguite).toBeGreaterThan(1);
  // L'utente non deve leggere che non si è aperto niente: si è aperto.
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
});
