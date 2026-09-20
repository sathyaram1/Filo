// Verifica #517 — giro 6, dal punto di vista dell'utente, nella chat della home.
//
//   1. l'ora scritta col PUNTO. «Ho messo la sveglia alle 19.30» è il modo in
//      cui in italiano si scrive un orario almeno quanto «19:30». La sveglia
//      delle 19:30 c'è davvero — l'ha appena messa Filo — e sotto la risposta
//      compare lo stesso «la sveglia non c'è». L'avviso accusa Filo di non
//      aver fatto una cosa che ha fatto, e la risposta già comparsa viene
//      buttata e rifatta con una seconda chiamata al modello;
//   2. un appunto salvato PRIMA nella conversazione copre ogni appunto
//      raccontato dopo. È la terza porta del rilievo del giro 5 («un appunto
//      salvato prima nella conversazione copre ogni appunto raccontato dopo,
//      e un evento di calendario copre ogni evento raccontato dopo»): per le
//      sveglie è stata chiusa guardando l'ora, per le altre famiglie no.
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

test('la sveglia che c\'è davvero, raccontata con l\'ora scritta col punto, non viene smentita', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // Filo la sveglia la mette DAVVERO, e poi la racconta scrivendo l'ora col
  // punto, come si scrive in italiano.
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'm1', name: 'SVEGLIA', arguments: '{"time":"19:30","label":"stasera"}' }] },
    { text: 'Ho messo la sveglia alle 19.30 per stasera.' },
  ]);

  await chiedi(page, 'mettimi la sveglia alle 19 e mezza per stasera');

  // La sveglia c'è: la frase è vera.
  const sveglie = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(sveglie.length).toBe(1);

  // Quindi sotto la risposta non ci deve essere nessuna accusa…
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // …e il turno non deve costare una seconda chiamata al modello per buttare
  // via una risposta giusta.
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(2);
});

test('un appunto salvato prima nella conversazione non copre quello raccontato adesso', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    // Primo turno: l'appunto della riunione lo scrive davvero.
    { text: '', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"lunedì alle 10","contesto":"riunione"}' }] },
    { text: 'Fatto, te l\'ho scritto.' },
    // Secondo turno: racconta un SECONDO appunto e non chiama niente.
    { text: 'Ti ho salvato l\'appunto con la lista della spesa.' },
  ]);

  await chiedi(page, 'segnami che la riunione è lunedì alle 10');
  await chiedi(page, 'segnami anche la lista della spesa: pane, uova, latte');

  // Della spesa non resta traccia da nessuna parte: l'utente deve leggerlo.
  await expect(page.locator('.dash-bubble-avviso')).not.toHaveCount(0);
});
