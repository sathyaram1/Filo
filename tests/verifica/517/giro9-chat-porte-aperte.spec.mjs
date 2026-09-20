// Verifica #517 — giro 9, dal punto di vista dell'utente, nella chat della home.
//
// Due porte:
//
//   1. L'utente chiede di sistemare un testo — «togli quella parola» — e Filo
//      glielo riscrive nella risposta. La frase con cui glielo consegna, «te
//      l'ho tolta», fa cancellare la risposta già comparsa a schermo,
//      rifarla con una seconda chiamata al modello e poi smentirla: sotto la
//      bolla compare che non è partito niente, col tasto «Fallo adesso» per
//      una cosa che Filo ha fatto. Chiedere di sistemare un testo è fra le
//      prime cose che si fanno in chat.
//   2. La conferma più corta — «Appunto salvato.» — dopo un appunto scritto
//      davvero prima nella conversazione passa senza una parola. È il turno
//      di prosecuzione della segnalazione: l'utente crede di avere la lista
//      della spesa e non ce l'ha.
//
// I test sono scritti per essere ROSSI finché le porte sono aperte.

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

const chiamate = (app) => app.evaluate(() => (globalThis.__captured || []).length);

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
}

test('un testo sistemato dentro la risposta non viene buttato e poi smentito', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Ecco la frase senza quella parola:\n\nIl gatto dorme sul divano.\n\nTe l\'ho tolta.' },
  ]);

  await chiedi(page, 'nella frase «il gatto grigio dorme sul divano» togli la parola grigio');

  // La frase corretta è nella risposta: non c'è nessuno strumento che possa
  // averla scritta, e non c'è niente da smentire.
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // …e la risposta non viene cancellata e rifatta: una chiamata al modello sola.
  expect(await chiamate(app)).toBe(1);
});

test('la conferma più corta non diventa muta dopo un appunto scritto prima', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    // Turno 1: l'appunto della riunione lo scrive davvero.
    { text: '', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"lunedì alle 10","contesto":"riunione"}' }] },
    { text: 'Fatto.' },
    // Turno 2: la lista della spesa la racconta e non chiama niente. Anche
    // dopo il ritentativo insiste, con la conferma più corta che c'è.
    { text: 'Appunto salvato.' },
    { text: 'Appunto salvato.' },
  ]);

  await chiedi(page, 'segnami che la riunione è lunedì alle 10');
  await chiedi(page, 'segnami anche la lista della spesa: pane, uova, latte');

  // Della spesa non esiste nessun appunto: l'utente deve leggerlo.
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(1);
});
