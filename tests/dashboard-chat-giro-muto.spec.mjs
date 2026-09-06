// Strumenti nativi nella chat della home — due esiti trovati dalla verifica:
//
//  (A) il modello scrive la frase per l'utente NELLO STESSO giro in cui chiama
//      l'azione («Ti metto la sveglia alle 7, buonanotte!») e, ricevuto
//      l'esito, non aggiunge niente. Prima la frase finiva come nota nel blocco
//      di attività chiuso e in chat non restava nessuna bolla. Ora la frase è
//      la risposta, e nel blocco non compare due volte.
//  (B) l'esito che torna al modello per un'impostazione applicata subito
//      diceva «Eseguita: Filo vuole impostare: Tema → Scuro..»: un «vuole»
//      dopo «Eseguita», e un punto doppio. Ora dice che è applicata.

import { test, expect } from './fixtures/electron.mjs';

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
  });
}

// Provider a copione: un elemento per giro ({ text, toolCalls }); le richieste
// ricevute finiscono in globalThis.__captured.
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

test('la frase scritta insieme all’azione, con l’ultimo giro muto, è la risposta (una volta sola)', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  const frase = 'Ti metto la sveglia alle 7, buonanotte!';
  await installScript(app, [
    { text: frase, toolCalls: [{ id: 'm1', name: 'SVEGLIA', arguments: '{"time":"07:00","label":"mattina"}' }] },
    { text: '' },
  ]);
  await page.locator('#input').fill('sveglia alle 7');
  await page.locator('#sendBtn').click();

  // SUCCESSO: la frase è in chat come risposta di Filo.
  await expect(page.locator('.dash-bubble-filo', { hasText: frase })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 5_000 });
  // La sveglia c'è davvero, e il blocco la racconta.
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.map((t) => t.label)).toEqual(['mattina']);
  const activity = await page.evaluate(() => ({
    label: document.querySelector('.dash-activity-label')?.textContent || '',
    rows: Array.from(document.querySelectorAll('.dash-activity-row')).map((n) => n.textContent.trim()),
    notes: Array.from(document.querySelectorAll('.dash-activity-note')).map((n) => n.textContent.trim()),
  }));
  expect(activity.label).toContain('impostato una sveglia');
  expect(activity.rows.some((r) => r.includes('Sveglia impostata · 07:00'))).toBe(true);
  // …e la frase non è anche una nota nel blocco.
  expect(activity.notes).toEqual([]);
  // Al turno dopo il modello rilegge la frase come propria risposta.
  await installScript(app, [{ text: 'Buonanotte.' }]);
  await page.locator('#input').fill('grazie');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Buonanotte.' })).toBeVisible({ timeout: 20_000 });
  const asst = await app.evaluate(() => globalThis.__captured[0].messages.filter((m) => m.role === 'assistant').pop());
  expect(String(asst.content)).toContain(frase);
});

test('un’impostazione applicata subito torna al modello come applicata, non come «Filo vuole»', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { toolCalls: [{ id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' }] },
    { text: 'Tema scuro attivo.' },
  ]);
  await page.locator('#input').fill('metti il tema scuro');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Tema scuro attivo.' })).toBeVisible({ timeout: 20_000 });
  const tool = await app.evaluate(() => globalThis.__captured[1].messages.filter((m) => m.role === 'tool').pop());
  expect(tool.tool_call_id).toBe('p1');
  expect(tool.content).toMatch(/^Eseguita: Impostazione applicata: Tema → Scuro\.$/);
  expect(tool.content).not.toMatch(/vuole/);
  expect(tool.content).not.toMatch(/\.\./);
});
