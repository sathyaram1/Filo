// Verifica indipendente (giro 5) — parte C: la cosa chiesta.
// Strumenti nativi, un turno solo, misure nella cronologia, ragionamento
// rimandato al modello, eventi in diretta nel blocco.
import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 15_000;
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

async function scriptProvider(app, script) {
  await app.evaluate(async (electron, s) => {
    globalThis.__rounds = [];
    globalThis.__tools = null;
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, tools, onToolCall, onDelta, onReasoning }) => {
      globalThis.__rounds.push(JSON.parse(JSON.stringify(messages)));
      if (tools) globalThis.__tools = tools.map((t) => (t.function && t.function.name) || '');
      const step = s[Math.min(i, s.length - 1)];
      i += 1;
      if (step.reasoning) { try { onReasoning && onReasoning(step.reasoning); } catch (_) {} }
      if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
      const calls = (step.toolCalls || []).map((c) => ({ ...c, arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments || {}) }));
      if (step.text) { try { onDelta && onDelta(step.text); } catch (_) {} }
      for (const c of calls) { try { onToolCall && onToolCall(c); } catch (_) {} }
      return { text: step.text || '', toolCalls: calls, reasoningDetails: step.reasoningDetails || [], model: attempts[0].model, provider: attempts[0].provider, usage: { prompt_tokens: 10, completion_tokens: 5 } };
    };
  }, script);
}

const ask = async (page, msg) => { await page.locator('#input').fill(msg); await page.locator('#sendBtn').click(); };
const rows = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.dash-activity-row')).map((e) => e.textContent.trim()));

// ── 1. Un turno solo: cerca, legge le capacità, mette sveglia e timer, risponde ──
test('un turno solo: cerca, legge le capacità, sveglia e timer, poi risponde — con le definizioni native', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: 'Cerco…', reasoning: 'Devo cercare il meteo.', reasoningDetails: [{ type: 'reasoning.text', text: 'penso' }],
      toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: { query: 'meteo Roma domani' } }] },
    { text: 'Verifico cosa so fare…', reasoningDetails: [{ type: 'reasoning.text', text: 'ancora' }],
      toolCalls: [{ id: 'c2', name: 'CAPACITA_DETTAGLIO', arguments: { voce: 'sveglia' } }] },
    { text: 'Metto sveglia e timer…',
      toolCalls: [
        { id: 'c3', name: 'SVEGLIA', arguments: { time: '07:00', label: 'domani' } },
        { id: 'c4', name: 'TIMER', arguments: { secondi: 600, etichetta: 'tè' } },
      ] },
    { text: 'Domani a Roma sereno. Sveglia alle 7 e timer da 10 minuti pronti.', reasoningDetails: [{ type: 'reasoning.text', text: 'concludo' }] },
  ]);

  await ask(page, 'che tempo fa domani a Roma? mettimi la sveglia alle 7 e un timer di 10 minuti per il tè');

  // In diretta: la riga della ricerca c'è PRIMA della risposta finale.
  await expect.poll(async () => (await rows(page)).join(' | '), { timeout: 25_000 }).toMatch(/Cerco sul web/);

  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Sveglia alle 7', { timeout: 40_000 });

  // Le definizioni degli strumenti sono partite native con la richiesta.
  const tools = await app.evaluate(() => globalThis.__tools);
  expect(Array.isArray(tools) && tools.length, JSON.stringify(tools)).toBeGreaterThan(10);
  expect(tools).toContain('CERCA_WEB');
  expect(tools).toContain('SVEGLIA');

  // Il diario ha tutte le righe, nell'ordine vero, senza doppioni.
  const r = await rows(page);
  const joined = r.join(' | ');
  expect(joined).toMatch(/Cerco sul web: meteo Roma domani/);
  expect(joined).toMatch(/Verifico cosa so fare/);
  expect(joined).toMatch(/Sveglia impostata/);
  expect(joined).toMatch(/Timer avviato/);
  expect(r.filter((x) => /Cerco sul web/.test(x)).length).toBe(1);

  // Le note di lavoro stanno nel blocco, non in chat.
  const bubbles = await page.evaluate(() => Array.from(document.querySelectorAll('.dash-bubble-filo')).map((e) => e.textContent));
  expect(bubbles.join(' ')).not.toMatch(/Verifico cosa so fare…/);

  // Il riassunto conta tutto.
  const head = await page.locator('.dash-activity-label').last().textContent();
  expect(head).toMatch(/cercato sul web/i);
  expect(head).toMatch(/impostato una sveglia/i);
  expect(head).toMatch(/avviato un timer/i);

  // Ragionamento strutturato rimandato al modello fra un giro e l'altro.
  const rounds = await app.evaluate(() => globalThis.__rounds.map((ms) => ms.filter((m) => m.reasoning_details).length));
  expect(rounds[rounds.length - 1], JSON.stringify(rounds)).toBeGreaterThan(0);

  // Sveglia e timer esistono davvero.
  const timers = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.some((t) => /domani/.test(t.label || ''))).toBe(true);
  expect(timers.some((t) => /tè/.test(t.label || ''))).toBe(true);

  // Cronologia AI: una voce per giro, con le misure e le azioni chiamate.
  const hist = await app.evaluate(async () => {
    const all = await globalThis.SN_HISTORY.list();
    return all.filter((h) => h.origin === 'filo:chat').map((h) => ({ timing: h.timing, output: String(h.output || '').slice(0, 200) }));
  });
  expect(hist.length, JSON.stringify(hist)).toBe(4);
  for (const h of hist) {
    expect(h.timing, JSON.stringify(h)).toBeTruthy();
    expect(typeof h.timing.totalMs, JSON.stringify(h.timing)).toBe('number');
  }
  expect(hist.map((h) => h.output).join(' | ')).toMatch(/\[Azioni: CERCA_WEB\]/);
  expect(hist.map((h) => h.output).join(' | ')).toMatch(/\[Azioni: SVEGLIA, TIMER\]/);
});

// ── 2. Il ragionamento del turno passato torna al modello al turno dopo ──
test('il ragionamento strutturato torna al modello anche al turno successivo', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [{ text: 'Ciao.', reasoningDetails: [{ type: 'reasoning.text', text: 'saluto' }] }]);
  await ask(page, 'ciao');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ciao', { timeout: 20_000 });

  await scriptProvider(app, [{ text: 'Di nuovo ciao.' }]);
  await ask(page, 'ancora');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Di nuovo ciao', { timeout: 20_000 });
  const first = await app.evaluate(() => JSON.stringify(globalThis.__rounds[0]));
  expect(first, first.slice(0, 1500)).toContain('reasoning_details');
});

// ── 3. Eventi in diretta: la riga compare mentre il turno lavora ancora ──
test('la riga dell’azione compare mentre il turno è ancora in corso', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { toolCalls: [{ id: 'x1', name: 'TIMER', arguments: { secondi: 60, etichetta: 'lento' } }] },
    { delayMs: 6000, text: 'Ecco fatto, con calma.' },
  ]);
  await ask(page, 'timer lento');
  // Mentre il secondo giro è ancora in volo: la riga c'è, la risposta no.
  await expect.poll(async () => (await rows(page)).join(' | '), { timeout: 20_000 }).toMatch(/Timer avviato · lento/);
  const bubbles = await page.evaluate(() => Array.from(document.querySelectorAll('.dash-bubble-filo')).map((e) => e.textContent).join(' '));
  expect(bubbles).not.toMatch(/con calma/);
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('con calma', { timeout: 30_000 });
});

// ── 4. Accoglienza: la spunta torna al modello come eseguita e ha la sua riga ──
test('spunta dell’accoglienza: riga nel diario ed esito eseguito', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  // Accoglienza attiva.
  await app.evaluate(async () => {
    const O = globalThis.SN_ONBOARDING;
    const st = O.start ? O.start() : { done: false, turns: [], checked: [] };
    await globalThis.SN_FILO_MEMORY.setOnboarding(st);
  });
  await scriptProvider(app, [
    { text: 'Piacere!', toolCalls: [{ id: 'o1', name: 'ONBOARDING', arguments: { spunta: ['profilo'] } }] },
    { text: 'Continuiamo.' },
  ]);
  await ask(page, 'mi chiamo Sathya e lavoro su Filo');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Continuiamo', { timeout: 30_000 });
  const r = (await rows(page)).join(' | ');
  expect(r, r).toMatch(/Accoglienza/);
  const second = await app.evaluate(() => globalThis.__rounds[1]);
  const tool = second.filter((m) => m.role === 'tool').map((m) => m.content).join(' | ');
  expect(tool, tool).toBeTruthy();
  expect(tool, tool).not.toMatch(/NON eseguita/i);
});
