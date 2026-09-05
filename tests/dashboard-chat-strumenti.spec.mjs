// Strumenti nativi nella chat della home: il modello chiama le azioni come
// tool calling, il main le esegue e lo richiama con gli esiti NELLO STESSO
// TURNO, e la scheda racconta tutto in diretta nel blocco di attività.
//
// Prima (JSON nel testo): «cerco, poi rispondo» costava un turno automatico
// per passo, il testo doveva venire prima delle azioni, e il modello chiudeva
// il turno annunciando cosa avrebbe fatto («appena tornano i risultati…»).
//
// Ogni test asserisce il successo dal punto di vista dell'utente, e senza il
// fix sarebbe rosso:
//  (A) un turno solo: due azioni chiamate come strumenti, gli esiti tornano
//      al modello (messaggi `tool` con `tool_call_id`, ragionamento
//      rimandato), la risposta finale è UNA bolla; il testo scritto a metà
//      lavoro è una nota nel blocco, le azioni sono righe nel blocco, e il
//      timer esiste davvero. Prima: con `toolCalls` nella risposta del
//      provider il main non eseguiva niente (leggeva solo il testo).
//  (B) un'azione di livello 2 chiamata come strumento apre il popup di
//      conferma e l'esito «in attesa di conferma» torna al modello, che
//      risponde con quello in mano.
//  (C) il modello nomina un'azione: la riga in testa lo dice PRIMA che gli
//      argomenti siano arrivati.

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

test('A — cerca, agisce e risponde in un turno solo; note e azioni nel blocco, una bolla sola', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__calls = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, tools, onReasoning, onDelta, onToolCall }) => {
      const n = globalThis.__calls.push({ messages: JSON.parse(JSON.stringify(messages)), tools: (tools || []).map((t) => t.function.name) });
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (n === 1) {
        try { onReasoning && onReasoning('Serve un timer e una verifica. '); } catch (_) {}
        await new Promise((r) => setTimeout(r, 300));
        const nota = 'Avvio il timer e controllo cosa so fare.';
        try { onDelta && onDelta(nota); } catch (_) {}
        try { onToolCall && onToolCall({ id: 'c1', name: 'TIMER' }); } catch (_) {}
        try { onToolCall && onToolCall({ id: 'c2', name: 'CAPACITA_DETTAGLIO' }); } catch (_) {}
        await new Promise((r) => setTimeout(r, 300));
        return {
          ...base, text: nota,
          toolCalls: [
            { id: 'c1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"Pasta"}' },
            { id: 'c2', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["save-for-later"]}' },
          ],
          reasoningDetails: [{ type: 'reasoning.text', text: 'Serve un timer e una verifica.' }],
          finishReason: 'tool_calls',
        };
      }
      try { onReasoning && onReasoning('Ora rispondo. '); } catch (_) {}
      const finale = 'Fatto: timer di 5 minuti avviato.';
      try { onDelta && onDelta(finale); } catch (_) {}
      return { ...base, text: finale, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('metti un timer per la pasta e dimmi se sai salvare per dopo');
  await page.locator('#sendBtn').click();

  // La risposta finale è l'unica bolla di Filo: la nota a metà lavoro non è
  // rimasta in chat.
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto: timer di 5 minuti avviato.' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-bubble-filo')).toHaveCount(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Avvio il timer e controllo' })).toHaveCount(0);

  // Un blocco solo, chiuso, col riassunto di tutto il lavoro.
  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveAttribute('data-phase', 'done');
  await expect(activity.locator('.dash-activity-label')).toHaveText(/^Ha avviato un timer e verificato cosa sa fare · \d+ s$/);

  // Dentro, nell'ordine: ragionamento, nota di lavoro, righe delle azioni,
  // ragionamento del secondo giro.
  await activity.locator('.dash-activity-head').click();
  const body = activity.locator('.dash-activity-body');
  await expect(body).toBeVisible();
  await expect(body.locator('.dash-activity-note')).toHaveText('Avvio il timer e controllo cosa so fare.');
  const timerRow = body.locator('.dash-activity-row', { hasText: 'Timer avviato' });
  await expect(timerRow).toHaveCount(1);
  await expect(timerRow).toContainText('Pasta');
  await expect(body.locator('.dash-activity-row', { hasText: 'Verifico cosa so fare' })).toHaveCount(1);
  await expect(body).toContainText('Serve un timer e una verifica.');
  await expect(body).toContainText('Ora rispondo.');
  const order = await body.evaluate((el) => Array.from(el.children).map((c) => c.className.split(' ').find((k) => k.startsWith('dash-activity-'))));
  expect(order).toEqual(['dash-activity-reasoning', 'dash-activity-note', 'dash-activity-row', 'dash-activity-row', 'dash-activity-reasoning']);
  await page.screenshot({ path: 'tests/agent/.out/strumenti-aperto.png' });

  // Al modello sono tornati gli esiti nello stesso turno, nella forma del
  // fornitore: il suo messaggio con le chiamate e il ragionamento, poi un
  // messaggio `tool` per chiamata.
  const calls = await app.evaluate(() => globalThis.__calls);
  expect(calls.length).toBe(2);
  expect(calls[0].tools).toContain('CERCA_WEB');
  expect(calls[0].tools).toContain('TIMER');
  const sys = calls[0].messages[0];
  expect(sys.role).toBe('system');
  expect(sys.content).not.toContain('"actions"');
  const m = calls[1].messages;
  const assistant = m[m.length - 3];
  expect(assistant.role).toBe('assistant');
  expect(assistant.tool_calls.map((c) => c.function.name)).toEqual(['TIMER', 'CAPACITA_DETTAGLIO']);
  expect(assistant.reasoning_details[0].text).toBe('Serve un timer e una verifica.');
  expect(m[m.length - 2]).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
  expect(m[m.length - 2].content).toMatch(/timer/i);
  expect(m[m.length - 1]).toMatchObject({ role: 'tool', tool_call_id: 'c2' });
  expect(m[m.length - 1].content).toContain('[Dettaglio delle capacità');

  // Il timer esiste davvero.
  const timers = await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.listTimers()).map((t) => t.label));
  expect(timers).toContain('Pasta');

  await app.evaluate(() => { try { globalThis.__restoreProvider?.(); } catch (_) {} });
});

test('B — un\'azione di livello 2 chiamata come strumento apre la conferma, e il modello risponde sapendolo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider2 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__calls2 = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__calls2.push({ messages: JSON.parse(JSON.stringify(messages)) });
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (n === 1) {
        try { onToolCall && onToolCall({ id: 'f1', name: 'INVIA_FEEDBACK' }); } catch (_) {}
        return {
          ...base, text: '',
          toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: '{"testo":"Il timer non suona.","titolo":"Timer muto"}' }],
          reasoningDetails: [], finishReason: 'tool_calls',
        };
      }
      const finale = 'Ti ho preparato la segnalazione: conferma e parte.';
      try { onDelta && onDelta(finale); } catch (_) {}
      return { ...base, text: finale, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('segnala che il timer non suona');
  await page.locator('#sendBtn').click();

  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ti ho preparato la segnalazione' })).toBeVisible({ timeout: 10_000 });
  // Il popup di conferma si apre da sé, con l'anteprima del testo.
  await expect(page.getByText('Filo chiede conferma')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Il timer non suona.')).toBeVisible();
  await page.screenshot({ path: 'tests/agent/.out/strumenti-conferma.png' });

  const calls = await app.evaluate(() => globalThis.__calls2);
  expect(calls.length).toBe(2);
  const m = calls[1].messages;
  expect(m[m.length - 1].role).toBe('tool');
  expect(m[m.length - 1].content).toMatch(/In attesa della conferma/);
  expect(m[m.length - 1].content).toMatch(/NON richiamare/);

  await app.evaluate(() => { try { globalThis.__restoreProvider2?.(); } catch (_) {} });
});

test('C — appena il modello nomina un\'azione la riga in testa lo dice, prima degli argomenti', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider3 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (n === 1) {
        try { onToolCall && onToolCall({ id: 't1', name: 'TIMER' }); } catch (_) {}
        // Gli argomenti «arrivano» dopo: nel frattempo la riga deve già dirlo.
        await new Promise((r) => setTimeout(r, 2500));
        return { ...base, text: '', toolCalls: [{ id: 't1', name: 'TIMER', arguments: '{"secondi":60,"etichetta":"Uovo"}' }], reasoningDetails: [], finishReason: 'tool_calls' };
      }
      try { onDelta && onDelta('Un minuto, via.'); } catch (_) {}
      return { ...base, text: 'Un minuto, via.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('timer di un minuto per l\'uovo');
  await page.locator('#sendBtn').click();

  const label = page.locator('.dash-activity .dash-activity-label');
  await expect(label).toHaveText('Avvio un timer…', { timeout: 3_000 });
  await expect(page.locator('.dash-activity')).toHaveAttribute('data-phase', 'act');
  await page.screenshot({ path: 'tests/agent/.out/strumenti-inizio.png' });

  await expect(page.locator('.dash-bubble-filo', { hasText: 'Un minuto, via.' })).toBeVisible({ timeout: 10_000 });
  await expect(label).toHaveText(/^Ha avviato un timer · \d+ s$/);

  await app.evaluate(() => { try { globalThis.__restoreProvider3?.(); } catch (_) {} });
});
