// Verifica #517 — giro 5, dal punto di vista dell'utente, nella chat della home.
//
//   1. una sveglia messa PRIMA nella stessa conversazione copre la sveglia
//      raccontata adesso a un'altra ora: in chat arriva «ti ho messo la
//      sveglia alle 19», fra le sveglie c'è solo quella delle 7, e sotto la
//      risposta non c'è niente. È il caso della segnalazione, in un turno di
//      prosecuzione — cioè proprio dove la segnalazione lo colloca;
//   2. una parolina fra «ho» e il participio («ti ho GIÀ messo la sveglia
//      alle 19») spegne il presidio per intero: nessun secondo tentativo,
//      nessun avviso, nessuna sveglia.
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

test('una sveglia messa prima non copre quella raccontata adesso a un\'altra ora', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    // Primo turno: la sveglia delle 7 la mette davvero.
    { text: '', toolCalls: [{ id: 'm1', name: 'SVEGLIA', arguments: '{"time":"07:00","label":"mattina"}' }] },
    { text: 'Fatto, sveglia alle 7.' },
    // Secondo turno: racconta una sveglia alle 19 e non chiama niente.
    { text: 'Ti ho messo la sveglia alle 19:00 per stasera.' },
  ]);

  await chiedi(page, 'mettimi la sveglia alle 7');
  await chiedi(page, 'mettimi anche la sveglia alle 19 per stasera');

  // Di sveglie ce n'è una sola, quella delle 7: quella delle 19 non esiste.
  const sveglie = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(sveglie.length).toBe(1);

  // Quindi l'utente deve leggere che la sveglia delle 19 non c'è.
  await expect(page.locator('.dash-bubble-avviso')).not.toHaveCount(0);
});

test('«ti ho GIÀ messo la sveglia» non passa in silenzio', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [{ text: 'Ti ho già messo la sveglia alle 19 per stasera.' }]);

  await chiedi(page, 'mettimi una sveglia alle 19 per stasera');

  expect(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).toHaveLength(0);
  // O il turno torna indietro al modello, o sotto la risposta c'è la riga che
  // dice che la sveglia non c'è. Oggi non c'è né l'uno né l'altra.
  const giri = await app.evaluate(() => globalThis.__captured.length);
  const avvisi = await page.locator('.dash-bubble-avviso').count();
  expect(giri > 1 || avvisi > 0).toBe(true);
});
