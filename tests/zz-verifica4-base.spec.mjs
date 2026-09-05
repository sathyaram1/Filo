// VERIFICA indipendente (temporaneo): la chat della home con strumenti nativi.
import { test, expect } from './fixtures/electron.mjs';

export async function newtabPage(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// Prepara: chiave finta, registro modelli di prova, accoglienza chiusa,
// ricerca web finta, provider pilotato da uno script di giri.
export async function setup(app, script, opts = {}) {
  await app.evaluate(async (electron, arg) => {
    const St = globalThis.SN_STORAGE;
    await St.updateSettings({
      provider: 'openrouter',
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      ...(arg.settings || {}),
    });
    // accoglienza chiusa: vogliamo la chat normale
    const Onb = globalThis.SN_ONBOARDING;
    if (Onb) await globalThis.SN_FILO_MEMORY.setOnboarding(Onb.close(Onb.emptyState()));

    globalThis.SN_WEB_SEARCH.search = async ({ query }) => ({
      ok: true, provider: 'finto',
      results: [{ title: `Risultato per ${query}`, url: 'https://esempio.test/uno', snippet: 'Snippet finto uno.' }],
    });

    globalThis.__v = { calls: [], i: 0, script: arg.script };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (req) => {
      const { tools, messages, onDelta, onReasoning, onToolCall } = req;
      // Senza strumenti non è la chat (home generata, lezioni, feedback auto):
      // rispondiamo con un JSON innocuo e non consumiamo lo script.
      if (!Array.isArray(tools) || !tools.length) {
        return { text: '{"text":""}', toolCalls: [], reasoningDetails: [], usage: {}, provider: 'openrouter', model: 'finto' };
      }
      const V = globalThis.__v;
      V.calls.push({
        tools: tools.map((t) => t.function.name),
        messages: JSON.parse(JSON.stringify(messages)),
      });
      const step = V.script[V.i] || V.script[V.script.length - 1];
      V.i += 1;
      if (step.throw) { const e = new Error(step.throw); throw e; }
      if (step.reasoning && onReasoning) { for (const t of step.reasoning) onReasoning(t); }
      if (step.text && onDelta) {
        for (const ch of String(step.text).match(/.{1,20}/gs) || []) onDelta(ch);
      }
      const calls = (step.toolCalls || []).map((c) => ({ ...c }));
      if (onToolCall) for (const c of calls) onToolCall(c);
      return {
        text: step.text || '', toolCalls: calls,
        reasoningDetails: step.reasoningDetails || [],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        provider: 'openrouter', model: 'finto',
      };
    };
  }, { script, settings: opts.settings });
}

export async function ask(page, text) {
  await page.locator('#input').fill(text);
  await page.locator('#sendBtn').click();
}

// Righe del blocco di attività (l'ultimo), aperto.
export async function activityRows(page) {
  return page.evaluate(() => {
    const blocks = document.querySelectorAll('.dash-activity');
    const b = blocks[blocks.length - 1];
    if (!b) return null;
    return {
      label: b.querySelector('.dash-activity-label').textContent,
      rows: Array.from(b.querySelectorAll('.dash-activity-row')).map((r) => r.textContent),
      notes: Array.from(b.querySelectorAll('.dash-activity-note')).map((r) => r.textContent),
      cmds: Array.from(b.querySelectorAll('.dash-activity-cmd')).map((r) => r.textContent),
    };
  });
}

test('cammino principale: cerca, legge le capacità, sveglia+timer, poi risponde — un turno solo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await setup(app, [
    {
      reasoning: ['Devo cercare. '],
      text: 'Cerco subito.',
      toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'meteo roma' }) }],
      reasoningDetails: [{ type: 'reasoning.text', text: 'pensiero' }],
    },
    {
      toolCalls: [
        { id: 'c2', name: 'CAPACITA_DETTAGLIO', arguments: JSON.stringify({ ids: ['save-for-later'] }) },
        { id: 'c3', name: 'SVEGLIA', arguments: JSON.stringify({ time: '07:00', label: 'palestra' }) },
        { id: 'c4', name: 'TIMER', arguments: JSON.stringify({ secondi: 120, etichetta: 'uova' }) },
      ],
    },
    { text: 'Ecco: domani piove. Sveglia e timer messi.' },
  ]);

  await ask(page, 'che tempo fa a roma? mettimi la sveglia alle 7 e un timer di 2 minuti');

  await expect(page.locator('.dash-bubble-filo').last())
    .toContainText('Ecco: domani piove', { timeout: 20_000 });

  const act = await activityRows(page);
  expect(act.label).toContain('Ha ');
  // Ordine vero delle azioni, niente doppioni
  expect(act.rows.join(' | ')).toMatch(/Cerco sul web.*meteo roma/);
  expect(act.rows.join(' | ')).toMatch(/Verifico cosa so fare/);
  expect(act.rows.join(' | ')).toMatch(/Sveglia impostata.*07:00/);
  expect(act.rows.join(' | ')).toMatch(/Timer avviato.*uova/);
  expect(act.rows.length).toBe(4);
  // La frase intermedia è una nota, non una bolla
  expect(act.notes.join(' ')).toContain('Cerco subito.');
  const bubbles = await page.locator('.dash-bubble-filo').allTextContents();
  expect(bubbles.join(' ')).not.toContain('Cerco subito.');
  // Riassunto: tutte le azioni contate
  expect(act.label).toContain('cercato sul web');
  expect(act.label).toContain('verificato cosa sa fare');
  expect(act.label).toContain('impostato una sveglia');
  expect(act.label).toContain('avviato un timer');

  // Il modello ha ricevuto le definizioni degli strumenti e gli esiti con lo
  // stesso id della chiamata.
  const calls = await app.evaluate(() => globalThis.__v.calls);
  expect(calls.length).toBe(3);
  expect(calls[0].tools).toContain('CERCA_WEB');
  const round2 = calls[1].messages;
  const toolMsgs = round2.filter((m) => m.role === 'tool');
  expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(['c1']);
  expect(toolMsgs[0].content).toContain('esempio.test/uno');
  const asst = round2.find((m) => m.role === 'assistant' && m.tool_calls);
  expect(asst.tool_calls[0].id).toBe('c1');
  expect(asst.reasoning_details).toBeTruthy();
  const round3 = calls[2].messages;
  expect(round3.filter((m) => m.role === 'tool').map((m) => m.tool_call_id).sort()).toEqual(['c1', 'c2', 'c3', 'c4']);

  // Sveglia e timer esistono davvero
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.length).toBe(2);
});

test('secondo turno: risultati ed esiti restano nel contesto', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await setup(app, [
    { text: 'Cerco.', toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'pizza' }) }] },
    { text: 'Trovato: esempio.test.' },
    { text: 'Come dicevo, esempio.test.' },
  ]);

  await ask(page, 'cerca pizza');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Trovato', { timeout: 20_000 });
  await ask(page, 'e il link?');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Come dicevo', { timeout: 20_000 });

  const calls = await app.evaluate(() => globalThis.__v.calls);
  const last = calls[calls.length - 1].messages;
  const blob = JSON.stringify(last);
  expect(blob).toContain('esempio.test/uno');
});

test('senza chiamate agli strumenti il turno finisce in una bolla sola', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [{ text: 'Ciao!' }]);
  await ask(page, 'ciao');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ciao!', { timeout: 20_000 });
  expect(await page.locator('.dash-activity').count()).toBe(0);
});
