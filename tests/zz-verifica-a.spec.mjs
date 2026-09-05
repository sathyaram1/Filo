// Verifica avversariale (temporaneo): cammino principale degli strumenti nativi.
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

// Copione: un array di giri. Ogni giro: { text, toolCalls, reasoningDetails, fail, delayMs }.
// Registra in globalThis.__verCalls cosa ha ricevuto il provider a ogni chiamata.
async function installScript(app, script) {
  await app.evaluate(async (script) => {
    globalThis.__verScript = script;
    globalThis.__verCalls = [];
    globalThis.__verIdx = 0;
    if (!globalThis.__verOrig) globalThis.__verOrig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, tools, toolChoice, onDelta, onReasoning, onToolCall }) => {
      const i = globalThis.__verIdx++;
      const step = globalThis.__verScript[Math.min(i, globalThis.__verScript.length - 1)] || {};
      globalThis.__verCalls.push({
        i,
        toolsNames: Array.isArray(tools) ? tools.map((t) => t.function && t.function.name) : null,
        toolChoice,
        messages: JSON.parse(JSON.stringify(messages)),
      });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      if (step.reasoningDetails) {
        for (const d of step.reasoningDetails) { try { onReasoning && onReasoning(d.text || ''); } catch (_) {} }
      }
      if (step.toolCalls) {
        for (const c of step.toolCalls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      }
      if (step.text) {
        const parts = step.text.match(/.{1,12}/gs) || [];
        for (const p of parts) { try { onDelta && onDelta(p); } catch (_) {} await wait(5); }
      }
      if (step.delayMs) await wait(step.delayMs);
      if (step.fail) throw new Error(step.fail);
      return {
        text: step.text || '',
        toolCalls: step.toolCalls || [],
        reasoningDetails: step.reasoningDetails || [],
        finishReason: step.toolCalls && step.toolCalls.length ? 'tool_calls' : 'stop',
        model: attempts[0].model, provider: attempts[0].provider, servedBy: 'test-host',
        usage: { promptTokens: 100, completionTokens: 20 },
      };
    };
    globalThis.SN_WEB_SEARCH.search = async ({ query }) => ({
      ok: true, provider: 'test', results: [
        { title: 'Risultato uno per ' + query, url: 'https://example.com/uno', snippet: 'Snippet UNO-MARK' },
        { title: 'Risultato due', url: 'https://example.com/due', snippet: 'Snippet DUE-MARK' },
      ],
    });
  }, script);
}

async function dumpChat(page) {
  return page.evaluate(() => {
    const q = (s, r = document) => Array.from(r.querySelectorAll(s));
    const txt = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null);
    return {
      bubbles: q('.dash-bubble-filo').map((b) => {
        const c = b.cloneNode(true);
        c.querySelectorAll('.dash-bubble-actions,.dash-activity').forEach((n) => n.remove());
        return txt(c);
      }),
      streaming: q('.dash-bubble-streaming').length,
      activities: q('.dash-activity').map((a) => ({
        cls: a.className,
        open: a.open, // se è un <details>
        head: txt(a.querySelector('.dash-activity-head')),
        rows: q('.dash-activity-row', a).map(txt),
        notes: q('.dash-activity-note', a).map(txt),
        reasoning: q('.dash-activity-reasoning', a).map(txt),
        cmds: q('.dash-activity-cmd', a).map(txt),
        html: a.outerHTML.slice(0, 1500),
      })),
      actions: q('.dash-bubble-actions .dash-action-btn').map(txt),
    };
  });
}

test('un turno: cerca, legge capacità, sveglia+timer, poi risponde — in diretta', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await installScript(app, [
    { reasoningDetails: [{ type: 'reasoning.text', text: 'Devo cercare e leggere.' }],
      toolCalls: [
        { id: 'call_1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'meteo Roma domani' }) },
        { id: 'call_2', name: 'CAPACITA_DETTAGLIO', arguments: JSON.stringify({ ids: ['translate-page'] }) },
      ], delayMs: 1200 },
    { reasoningDetails: [{ type: 'reasoning.text', text: 'Ora la sveglia.' }],
      text: 'Un attimo, metto sveglia e timer…',
      toolCalls: [
        { id: 'call_3', name: 'SVEGLIA', arguments: JSON.stringify({ time: '07:00', label: 'lavoro' }) },
        { id: 'call_4', name: 'TIMER', arguments: JSON.stringify({ secondi: 600, etichetta: 'pasta' }) },
      ], delayMs: 1200 },
    { text: 'RISPOSTA-FINALE: domani a Roma sole (UNO-MARK), sveglia alle 7 e timer di 10 minuti messi.' },
  ]);

  await page.locator('#input').fill('cerca il meteo di Roma domani, dimmi come si traduce una pagina e mettimi la sveglia alle 7 e un timer di 10 minuti');
  await page.locator('#sendBtn').click();

  // In diretta: mentre lavora (prima della risposta) il blocco di attività c'è già.
  const live = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 3500) {
    const d = await dumpChat(page);
    live.push(d);
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log('LIVE-SAMPLES', JSON.stringify(live.map((d) => ({ heads: d.activities.map((a) => a.head), rows: d.activities.map((a) => a.rows), notes: d.activities.map((a) => a.notes), bubbles: d.bubbles })), null, 1));

  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA-FINALE' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.dash-bubble-streaming')).toHaveCount(0, { timeout: 3_000 });
  const finalDump = await dumpChat(page);
  console.log('FINAL', JSON.stringify(finalDump, null, 1));

  const calls = await app.evaluate(() => globalThis.__verCalls);
  console.log('CALLS', JSON.stringify(calls.map((c) => ({ i: c.i, toolsNames: c.toolsNames, toolChoice: c.toolChoice, tail: c.messages.slice(-6) })), null, 1));
  expect(calls.length).toBe(3);
  // Le definizioni partono con la richiesta.
  expect(calls[0].toolsNames).toContain('CERCA_WEB');
  expect(calls[0].toolsNames).toContain('SVEGLIA');
  // Gli esiti tornano con lo stesso id.
  const toolMsgs2 = calls[1].messages.filter((m) => m.role === 'tool');
  expect(toolMsgs2.map((m) => m.tool_call_id).sort()).toEqual(['call_1', 'call_2']);
  expect(toolMsgs2.find((m) => m.tool_call_id === 'call_1').content).toContain('UNO-MARK');
  expect(toolMsgs2.find((m) => m.tool_call_id === 'call_2').content.toLowerCase()).toContain('tradu');
  // Il ragionamento torna al modello fra un giro e l'altro.
  const asst2 = calls[1].messages.filter((m) => m.role === 'assistant' && m.tool_calls);
  expect(asst2.length).toBeGreaterThan(0);
  expect(JSON.stringify(asst2[asst2.length - 1].reasoning_details || [])).toContain('Devo cercare');
  const toolMsgs3 = calls[2].messages.filter((m) => m.role === 'tool');
  expect(toolMsgs3.map((m) => m.tool_call_id).sort()).toEqual(['call_1', 'call_2', 'call_3', 'call_4']);

  // Sveglia e timer esistono davvero.
  const timers = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listTimers());
  console.log('TIMERS', JSON.stringify(timers));
  expect(timers.some((t) => /lavoro/i.test(t.label || ''))).toBe(true);
  expect(timers.some((t) => /pasta/i.test(t.label || ''))).toBe(true);

  // Cronologia AI: una voce per giro con le misure.
  const hist = await app.evaluate(async () => globalThis.SN_HISTORY.list());
  console.log('HIST', JSON.stringify(hist.map((h) => ({ action: h.action, model: h.model, timing: h.timing, input: typeof h.input === 'string' ? h.input.slice(0, 80) : h.input, output: (h.output || '').slice(0, 200), origin: h.origin, tools: h.tools || h.toolCalls || h.actions })), null, 1));

  // Secondo turno: i risultati della ricerca restano in contesto.
  await installScript(app, [{ text: 'SECONDA: lo avevo già cercato.' }]);
  await page.locator('#input').fill('e cosa avevi trovato?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'SECONDA' })).toBeVisible({ timeout: 15_000 });
  const calls2 = await app.evaluate(() => globalThis.__verCalls);
  const all = JSON.stringify(calls2[0].messages);
  console.log('TURN2-MSGS', JSON.stringify(calls2[0].messages.slice(-8), null, 1));
  expect(all).toContain('UNO-MARK');
  expect(all).toContain('RISPOSTA-FINALE');

  try { await page.screenshot({ path: 'tests/.shots/zz-verifica-a-light.png' }); } catch (_) {}
});
