// Verifica #517 — giro 3, dal punto di vista dell'utente, con Filo aperto.
//
// Le due porte del giro 2 sono chiuse su una forma sola per parte. Qui le si
// riapre dal lato utente, sulla stessa causa: cosa vale come prova.
//
//   1. l'utente chiede un evento di calendario. Filo CHIAMA lo strumento, in
//      chat compare il bottone da premere, e poi lo racconta: la risposta
//      viene buttata via, rifatta con una seconda chiamata al modello, e sotto
//      compare che l'evento non è in calendario. Il tasto «Fallo adesso» non
//      porta da nessuna parte: Filo può solo riproporre lo stesso bottone;
//   2. la sveglia c'è davvero, messa in una sessione precedente. In una chat
//      nuova l'utente chiede se c'è e Filo risponde col pronome, come si
//      risponde in italiano: «sì, te l'ho messa alle 19». È vero, e l'utente
//      legge l'accusa.
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

test('l\'evento di calendario messo in chat come bottone non viene smentito', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    // Filo fa esattamente quello che deve: chiama lo strumento. In chat
    // compare il bottone «aggiungi al calendario».
    { text: '', toolCalls: [{ id: 'c1', name: 'EVENTO_CALENDARIO', arguments: '{"data":"2026-09-21","ora":"10:00","titolo":"Riunione"}' }] },
    // …e poi lo racconta all'utente.
    { text: 'Ti ho aggiunto l\'evento in calendario per domani alle 10.' },
  ]);
  await chiedi(page, 'aggiungimi al calendario la riunione di domani alle 10');

  // L'utente non deve leggere che non è successo niente: il bottone è lì.
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // E la risposta non va buttata e rifatta: due chiamate al modello, non tre.
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(2);
});

test('la sveglia messa ieri regge la conferma col pronome in una chat nuova', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // La sveglia esiste davvero, e non è nata in questa conversazione.
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.addAlarm({ label: 'sera', time: '19:00' }));
  await installScript(app, [{ text: 'Sì, te l\'ho messa alle 19:00 come mi avevi chiesto.' }]);
  await chiedi(page, 'hai messo la sveglia per stasera?');

  // La sveglia c'è: la frase è vera, e nessuno deve smentirla.
  expect(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).toHaveLength(1);
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // Nessun rimbalzo: una chiamata sola al modello.
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(1);
});
