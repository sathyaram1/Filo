// Verifica #517 — giro 1, dal punto di vista dell'utente, con Filo aperto.
//
// Tre porte trovate aperte al primo giro, e chiuse:
//   1. la risposta buona scritta come PREAMBOLO e la chiamata lasciata scritta
//      sotto: il turno passava intero, senza nemmeno un ritentativo, e la
//      sveglia non esisteva. È l'altra metà del sintomo della segnalazione.
//   2. il formato interno ripetuto anche dopo il ritentativo: all'utente
//      restava un blocco di codice e nessuna riga che dicesse cosa non era
//      successo, mentre la dichiarazione a parole l'avviso ce l'aveva.
//   3. Filo apre una cosa con un comando di shell e poi lo racconta: l'utente
//      leggeva che «non si è aperto niente», e invece il comando era partito.

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
    // La frase per l'utente, e sotto la chiamata SCRITTA invece che fatta.
    { text: 'Ti metto una sveglia alle 19:00 per stasera.\n\nSVEGLIA{"time":"19:00","label":"sera"}' },
    // Rimandato indietro, il modello la chiama per davvero.
    { text: '', toolCalls: [{ id: 'm1', name: 'SVEGLIA', arguments: '{"time":"19:00","label":"sera"}' }] },
    { text: 'Ecco, la sveglia delle 19:00 adesso c\'è.' },
  ]);
  await chiedi(page, 'mettimi una sveglia alle 19 per stasera');

  // SUCCESSO dal punto di vista dell'utente: la sveglia esiste davvero.
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.map((t) => t.label)).toEqual(['sera']);

  // Il turno è stato rimandato indietro: prima bastava una frase davanti alla
  // chiamata scritta perché passasse tutto intero, senza un secondo tentativo.
  expect(await app.evaluate(() => globalThis.__captured.length)).toBeGreaterThan(1);

  // All'utente non resta il formato interno scritto in chat, e nessun avviso:
  // la cosa è stata fatta.
  await expect(page.locator('.dash-bubble-filo').last()).not.toContainText('SVEGLIA{');
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // E del giro rimandato indietro resta scritta una riga nel blocco di lavoro:
  // una risposta che si cancella da sola, senza una parola, sembra un guasto.
  await expect(page.locator('.dash-activity-row')).toContainText(['Risposta rifatta']);
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

  // La dichiarazione a parole, in questa stessa situazione, l'avviso ce l'ha:
  // adesso ce l'ha anche questa, e dice che lì dentro non è successo niente.
  const avviso = page.locator('.dash-bubble-avviso');
  await expect(avviso).toBeVisible({ timeout: 10_000 });
  await expect(avviso).toContainText('non è stato fatto');
  // E l'utente non deve riscrivere la richiesta a mano per riprovare.
  await expect(page.locator('.dash-bubble-actions button')).toContainText(['Fallo adesso']);
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
