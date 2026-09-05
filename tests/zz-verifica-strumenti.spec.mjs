// Verifica indipendente (temporanea): strumenti nativi nella chat della home.
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

// Installa un provider a copione: `script` è un array di giri; ogni giro è
// { text, toolCalls, reasoning, delayMs, throw }. Le chiamate ricevute (messages,
// tools) vengono registrate in globalThis.__captured.
async function installScript(app, script) {
  await app.evaluate(async (_electron, script) => {
    if (!globalThis.__origStream) globalThis.__origStream = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__captured = [];
    globalThis.__script = script;
    if (!globalThis.__errs) {
      globalThis.__errs = [];
      const oe = console.error;
      console.error = (...a) => { globalThis.__errs.push(a.map((x) => (x && x.stack) || String(x)).join(' ')); oe(...a); };
    }
    globalThis.__callIdx = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, tools, onDelta, onReasoning, onToolCall }) => {
      const i = globalThis.__callIdx++;
      const step = globalThis.__script[Math.min(i, globalThis.__script.length - 1)];
      globalThis.__captured.push({ messages: JSON.parse(JSON.stringify(messages)), toolsCount: Array.isArray(tools) ? tools.length : -1, toolNames: (tools || []).map((t) => t.function && t.function.name) });
      await new Promise((r) => setTimeout(r, step.delayMs || 50));
      if (step.throw) { const e = new Error(step.throw); e.status = 500; throw e; }
      if (step.reasoning) { try { onReasoning && onReasoning(step.reasoning); } catch (_) {} }
      for (const c of step.toolCalls || []) { try { onToolCall && onToolCall({ id: c.id || '', name: c.name }); } catch (_) {} }
      if (step.text) { try { onDelta && onDelta(step.text); } catch (_) {} }
      return {
        text: step.text || '',
        toolCalls: step.toolCalls || [],
        reasoningDetails: step.reasoning ? [{ type: 'reasoning.text', text: step.reasoning, index: 0 }] : [],
        model: attempts[0].model, provider: attempts[0].provider, usage: { promptTokens: 10, completionTokens: 5 },
      };
    };
  }, script);
}

async function stubSearch(app) {
  await app.evaluate(() => {
    globalThis.SN_WEB_SEARCH.search = async ({ query }) => ({
      provider: 'finto',
      results: [{ title: `Risultato per ${query}`, url: 'https://esempio.test/meteo', snippet: 'Domani pioggia a Roma.' }],
    });
  });
}

async function sendAndWait(page, text, expectText, timeout = 30_000) {
  await page.locator('#input').fill(text);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: expectText }).last().or(page.locator('.dash-action-btn', { hasText: 'Riprova' }).last())).toBeVisible({ timeout });
  const errs = await page.context()._browser?.__app?.evaluate?.(() => globalThis.__errs) ?? null;
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 5_000 });
}
async function dumpErrs(app) {
  const errs = await app.evaluate(() => globalThis.__errs || []);
  if (errs.length) console.log('MAIN ERRORS:', JSON.stringify(errs, null, 1));
}

async function activityState(page) {
  return page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll('.dash-activity'));
    return blocks.map((b) => ({
      phase: b.dataset.phase,
      failed: b.dataset.failed || '',
      label: (b.querySelector('.dash-activity-label') || {}).textContent || '',
      rows: Array.from(b.querySelectorAll('.dash-activity-row')).map((r) => r.textContent.trim()),
      notes: Array.from(b.querySelectorAll('.dash-activity-note')).map((r) => r.textContent.trim()),
      reasoning: Array.from(b.querySelectorAll('.dash-activity-reasoning')).map((r) => r.textContent.trim()),
      bodyHtml: (b.querySelector('.dash-activity-body') || {}).innerHTML || '',
    }));
  });
}

async function filoBubbles(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.dash-bubble-filo')).map((b) => {
    const clone = b.cloneNode(true);
    clone.querySelectorAll('.dash-bubble-actions').forEach((n) => n.remove());
    return (clone.textContent || '').trim();
  }));
}

test('A — cerca, legge, mette sveglia e timer, poi risponde: un turno solo', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await stubSearch(app);
  await installScript(app, [
    { reasoning: 'Devo cercare il meteo. ', text: 'Cerco il meteo di Roma…', toolCalls: [{ id: 'call_a', name: 'CERCA_WEB', arguments: '{"query":"meteo Roma"}' }] },
    { reasoning: 'Ora leggo cosa so fare. ', toolCalls: [{ id: 'call_b', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["timer"]}' }] },
    { text: '', toolCalls: [
      { id: 'call_c', name: 'SVEGLIA', arguments: '{"time":"23:59","label":"verifica"}' },
      { id: 'call_d', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"pasta"}' },
    ] },
    { text: 'Domani pioggia a Roma. Sveglia alle 23:59 e timer pasta messi.' },
    { text: 'Seconda risposta.' },
  ]);

  await sendAndWait(page, 'cerca il meteo di roma, controlla cosa sai fare e mettimi una sveglia alle 23:59 e un timer di 5 minuti', 'Domani pioggia');

  const captured = await app.evaluate(() => globalThis.__captured);
  expect(captured.length).toBe(4);
  // Gli strumenti sono nativi: la richiesta porta le definizioni.
  expect(captured[0].toolsCount).toBeGreaterThan(10);
  expect(captured[0].toolNames).toContain('SVEGLIA');
  expect(captured[0].toolNames).not.toContain('ONBOARDING');
  // Giro 2: l'assistente col tool_call e il tool message con lo stesso id e i risultati.
  const m2 = captured[1].messages;
  const asst2 = m2.filter((m) => m.role === 'assistant' && m.tool_calls);
  expect(asst2.length).toBe(1);
  expect(asst2[0].tool_calls[0].id).toBe('call_a');
  expect(asst2[0].tool_calls[0].function.name).toBe('CERCA_WEB');
  expect(asst2[0].reasoning_details && asst2[0].reasoning_details[0].text).toBe('Devo cercare il meteo. ');
  const tool2 = m2.filter((m) => m.role === 'tool');
  expect(tool2.length).toBe(1);
  expect(tool2[0].tool_call_id).toBe('call_a');
  expect(tool2[0].content).toContain('https://esempio.test/meteo');
  // L'ordine: assistant → tool, e il tool messaggio è l'ultimo.
  expect(m2[m2.length - 1].role).toBe('tool');
  // Giro 3: dettaglio capacità come esito.
  const tool3 = captured[2].messages.filter((m) => m.role === 'tool');
  expect(tool3.length).toBe(2);
  expect(tool3[1].tool_call_id).toBe('call_b');
  // Giro 4: i due esiti (sveglia+timer) con id giusti.
  const tool4 = captured[3].messages.filter((m) => m.role === 'tool');
  expect(tool4.map((t) => t.tool_call_id)).toEqual(['call_a', 'call_b', 'call_c', 'call_d']);
  expect(tool4[2].content).toMatch(/Eseguita/);
  expect(tool4[3].content).toMatch(/Eseguita/);
  console.log('TOOL RESULTS giro4:', JSON.stringify(tool4.map((t) => t.content.slice(0, 200)), null, 1));

  // Timer e sveglia esistono davvero.
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.length).toBe(2);

  // UI: la risposta è UNA bolla; la nota di lavoro non è una bolla.
  const bubbles = await filoBubbles(page);
  console.log('BUBBLES:', JSON.stringify(bubbles));
  expect(bubbles.filter((t) => t.includes('Domani pioggia')).length).toBe(1);
  expect(bubbles.some((t) => t.includes('Cerco il meteo'))).toBe(false);

  const acts = await activityState(page);
  console.log('ACTIVITY:', JSON.stringify(acts, null, 1));
  expect(acts.length).toBe(1);
  const a = acts[0];
  expect(a.phase).toBe('done');
  expect(a.label).toMatch(/^Ha cercato sul web, verificato cosa sa fare, impostato una sveglia e avviato un timer · \d+ s$/);
  expect(a.rows.length).toBe(4);
  expect(a.rows[0]).toContain('Cerco sul web: meteo Roma');
  expect(a.rows[2]).toContain('Sveglia impostata · 23:59 · verifica');
  expect(a.rows[3]).toContain('Timer avviato · pasta · 5 min');
  expect(a.notes).toEqual(['Cerco il meteo di Roma…']);
  expect(a.reasoning.join('|')).toContain('Devo cercare il meteo');
  expect(a.reasoning.join('|')).toContain('Ora leggo cosa so fare');
  // Ordine nel diario: ragionamento, nota, riga ricerca, ragionamento, riga capacità, sveglia, timer.
  const order = await page.evaluate(() => Array.from(document.querySelector('.dash-activity-body').children).map((c) => c.className.split(' ').pop() + ':' + c.textContent.trim().slice(0, 30)));
  console.log('ORDER:', JSON.stringify(order));

  // Aprire il blocco.
  await page.locator('.dash-activity-head').click();
  await expect(page.locator('.dash-activity-body')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/zz-verifica-strumenti-A.png' });

  // Cronologia AI: una voce per giro, con misure.
  const hist = await app.evaluate(async () => {
    const items = await globalThis.SN_HISTORY.list();
    return items.filter((i) => i.action === globalThis.SN_CONST.ACTIONS.FILO_CHAT).map((i) => ({ output: String(i.output || '').slice(0, 120), timing: i.timing, costEur: i.costEur, usage: i.usage }));
  });
  console.log('HISTORY:', JSON.stringify(hist, null, 1));
  expect(hist.length).toBe(4);
  for (const h of hist) { expect(h.timing && h.timing.totalMs).toBeGreaterThan(0); }
  expect(hist.some((h) => h.output.includes('[Azioni: CERCA_WEB]'))).toBe(true);
  expect(hist.some((h) => h.output.includes('[Azioni: SVEGLIA, TIMER]'))).toBe(true);

  // Turno seguente: il ragionamento e gli esiti tornano al modello.
  await sendAndWait(page, 'grazie', 'Seconda risposta');
  const captured2 = await app.evaluate(() => globalThis.__captured);
  const m5 = captured2[4].messages;
  const prevAsst = m5.filter((m) => m.role === 'assistant');
  console.log('TURN2 MESSAGES:', JSON.stringify(m5.map((m) => ({ role: m.role, content: String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 100), rd: !!m.reasoning_details, tc: !!m.tool_calls })), null, 1));
  expect(prevAsst.length).toBeGreaterThan(0);
  expect(prevAsst[prevAsst.length - 1].content).toContain('Domani pioggia');
  // Niente tool message orfano nel turno nuovo.
  expect(m5.filter((m) => m.role === 'tool').length).toBe(0);
  const acts2 = await activityState(page);
  expect(acts2.length).toBe(2);
});

test('B — esiti onesti per le azioni senza niente da mostrare; sveglia tolta/spostata nel diario; chiamate senza id', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'lezione', seconds: 3600 });
    await globalThis.SN_FILO_MEMORY.addAlarm({ label: 'palestra', time: '23:58' });
  });
  await installScript(app, [
    // Tutte SENZA id dal fornitore.
    { text: 'Faccio tutto.', toolCalls: [
      { id: '', name: 'SALVA_APPUNTO', arguments: '{"testo":"comprare il latte","contesto":"spesa"}' },
      { id: '', name: 'SALVA_LEZIONE', arguments: '{"testo":"L\'utente vuole risposte brevi."}' },
      { id: '', name: 'MODIFICA_SVEGLIA', arguments: '{"etichetta":"palestra","orario":"23:57"}' },
      { id: '', name: 'CANCELLA_SVEGLIA', arguments: '{"etichetta":"lezione"}' },
      { id: '', name: 'NAVIGA', arguments: '{"url":"filo://newtab/","etichetta":"Home","background":true}' },
      { id: '', name: 'RIMUOVI_PROXY_TUTTE', arguments: '{}' },
      { id: '', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' },
      { id: '', name: 'CANCELLA_SVEGLIA', arguments: '{"etichetta":"inesistente"}' },
    ] },
    { text: 'Fatto tutto.' },
  ]);
  await sendAndWait(page, 'ricordami di comprare il latte, ricorda che voglio risposte brevi, sposta palestra alle 23:57, togli lezione, vai alla home, togli i proxy', 'Fatto tutto');

  const captured = await app.evaluate(() => globalThis.__captured);
  expect(captured.length).toBe(2);
  const m2 = captured[1].messages;
  const asst = m2.filter((m) => m.role === 'assistant' && m.tool_calls)[0];
  const ids = asst.tool_calls.map((c) => c.id);
  const tools = m2.filter((m) => m.role === 'tool');
  console.log('IDS:', JSON.stringify(ids), '\nTOOLS:', JSON.stringify(tools.map((t) => [t.tool_call_id, t.content]), null, 1));
  expect(tools.map((t) => t.tool_call_id)).toEqual(ids);
  expect(new Set(ids).size).toBe(8);
  expect(ids.every((x) => x)).toBe(true);
  // Regressione livello 2 del giro passato: eseguite davvero → mai «NON eseguita».
  for (const k of [0, 1, 2, 3, 4, 5, 6]) {
    expect(tools[k].content).not.toMatch(/NON eseguita|non riuscita/i);
  }
  expect(tools[2].content).toMatch(/Spostat/);
  expect(tools[3].content).toMatch(/Tolt/);
  expect(tools[7].content).toMatch(/Nessuna sveglia/);

  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  console.log('TIMERS:', JSON.stringify(timers));
  expect(timers.length).toBe(1);
  expect(timers[0].label).toBe('palestra');

  const lessons = await app.evaluate(() => globalThis.SN_FILO_MEMORY.lessonsBufferText ? globalThis.SN_FILO_MEMORY.lessonsBufferText() : null);
  console.log('LESSONS:', JSON.stringify(lessons));

  const acts = await activityState(page);
  console.log('ACTIVITY B:', JSON.stringify(acts, null, 1));
  const a = acts[0];
  expect(a.rows.some((r) => r.startsWith('Spostata ·') && r.includes('palestra'))).toBe(true);
  expect(a.rows.some((r) => r.startsWith('Cancellata ·') && r.includes('lezione'))).toBe(true);
  // Nessuna riga doppia.
  expect(a.rows.filter((r) => r.startsWith('Spostata')).length).toBe(1);
  expect(a.rows.filter((r) => r.startsWith('Cancellata')).length).toBe(1);
  expect(a.label).toContain('spostato una sveglia');
  expect(a.label).toContain('cancellato una sveglia');
  await page.locator('.dash-activity-head').click();
  await page.screenshot({ path: 'tests/.shots/zz-verifica-strumenti-B.png' });
  const bubbles = await filoBubbles(page);
  console.log('BUBBLES B:', JSON.stringify(bubbles));
  // Bottoni sotto la risposta: il link Home resta cliccabile (non è una riga).
  const btns = await page.locator('.dash-bubble-actions .dash-action-btn').allTextContents();
  console.log('BTNS B:', JSON.stringify(btns));
});

test('C — tetto dei giri: Filo dice che si è fermato', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Ci lavoro ancora…', toolCalls: [{ id: 'x', name: 'TIMER', arguments: '{"secondi":600,"etichetta":"loop"}' }], delayMs: 20 },
  ]);
  await page.locator('#input').fill('metti timer all infinito');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 60_000 });
  const captured = await app.evaluate(() => globalThis.__captured.length);
  console.log('ROUNDS:', captured);
  const bubbles = await filoBubbles(page);
  console.log('BUBBLES C:', JSON.stringify(bubbles));
  expect(bubbles.join('|')).toMatch(/fermato/i);
  const acts = await activityState(page);
  console.log('ACTIVITY C label:', acts[0].label, 'rows', acts[0].rows.length, 'notes', acts[0].notes.length);
  // Nel giro 2 l'id 'x' è duplicato dal fornitore in ogni giro: gli id delle risposte devono comunque corrispondere.
  const all = await app.evaluate(() => globalThis.__captured.map((c) => c.messages.filter((m) => m.role === 'tool').map((t) => t.tool_call_id)));
  console.log('TOOL IDS PER ROUND:', JSON.stringify(all.slice(0, 3)));
  await page.screenshot({ path: 'tests/.shots/zz-verifica-strumenti-C.png' });
});

test('D — stress: strumento ignoto, argomenti rotti, HTML nella query, errore a metà, formato vecchio', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await stubSearch(app);
  const xss = '<img src=x onerror="document.title=\'XSS\'">';
  await installScript(app, [
    { toolCalls: [
      { id: 'u1', name: 'FOO_BAR', arguments: '{}' },
      { id: 'u2', name: 'TIMER', arguments: '{secondi: 60' },
      { id: 'u3', name: 'CERCA_WEB', arguments: JSON.stringify({ query: xss }) },
      { id: 'u4', name: 'TIMER', arguments: '[1,2]' },
      { id: 'u5', name: '', arguments: '{}' },
    ] },
    { text: 'Risposta dopo lo stress.' },
  ]);
  await sendAndWait(page, 'stress', 'Risposta dopo lo stress');
  const captured = await app.evaluate(() => globalThis.__captured);
  const tools = captured[1].messages.filter((m) => m.role === 'tool');
  console.log('TOOLS D:', JSON.stringify(tools.map((t) => [t.tool_call_id, t.content.slice(0, 160)]), null, 1));
  expect(tools.map((t) => t.tool_call_id)).toEqual(['u1', 'u2', 'u3', 'u4']);
  expect(tools[0].content).toMatch(/NON eseguita/);
  expect(tools[1].content).toMatch(/NON eseguita/);
  expect(tools[3].content).toMatch(/NON eseguita/);
  const title = await page.title();
  expect(title).not.toBe('XSS');
  const acts = await activityState(page);
  console.log('ACTIVITY D:', JSON.stringify(acts, null, 1));
  expect(acts[0].bodyHtml).not.toContain('<img');
  expect(acts[0].rows.some((r) => r.includes('<img src=x'))).toBe(true);
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.length).toBe(0);

  // Errore del fornitore al secondo giro dopo un'azione già eseguita.
  await installScript(app, [
    { toolCalls: [{ id: 'e1', name: 'TIMER', arguments: '{"secondi":120,"etichetta":"prima"}' }] },
    { throw: 'OpenRouter 500: giù' },
    { text: 'Ripreso.' },
  ]);
  await page.locator('#input').fill('timer 2 minuti poi rompiti');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-action-btn', { hasText: 'Riprova' })).toBeVisible({ timeout: 20_000 });
  const acts2 = await activityState(page);
  console.log('ACTIVITY D2:', JSON.stringify(acts2[acts2.length - 1], null, 1));
  const last = acts2[acts2.length - 1];
  expect(last.failed).toBe('1');
  expect(last.rows.some((r) => r.includes('Timer avviato'))).toBe(true);
  const timers2 = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers2.length).toBe(1);
  await page.screenshot({ path: 'tests/.shots/zz-verifica-strumenti-D2.png' });
  // Riprova: il turno riparte (il copione è al giro 3: risposta).
  await page.locator('.dash-action-btn', { hasText: 'Riprova' }).click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ripreso' })).toBeVisible({ timeout: 20_000 });

  // Formato vecchio (JSON nel testo) ancora tollerato.
  await installScript(app, [
    { text: JSON.stringify({ text: 'Vecchio stile.', actions: [{ type: 'TIMER', secondi: 30, etichetta: 'legacy' }] }) },
  ]);
  await sendAndWait(page, 'legacy', 'Vecchio stile');
  const bubbles = await filoBubbles(page);
  expect(bubbles.some((b) => b.includes('{"text"'))).toBe(false);
  const timers3 = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers3.length).toBe(2);
  const acts3 = await activityState(page);
  console.log('ACTIVITY D3:', JSON.stringify(acts3[acts3.length - 1], null, 1));
  expect(acts3[acts3.length - 1].rows.some((r) => r.includes('legacy'))).toBe(true);
});

test('E — pagina cronologia: misure per turno visibili', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { reasoning: 'Penso. ', toolCalls: [{ id: 'h1', name: 'TIMER', arguments: '{"secondi":90,"etichetta":"storia"}' }], delayMs: 200 },
    { text: 'Timer messo.', delayMs: 100 },
  ]);
  await sendAndWait(page, 'timer 90 secondi', 'Timer messo');
  await dumpErrs(app);
  const hp = await openTab('filo://history/history.html');
  await hp.waitForLoadState('domcontentloaded');
  await expect(hp.locator('.sn-history-timing').first()).toBeVisible({ timeout: 10_000 });
  const chips = await hp.locator('.sn-history-timing').allTextContents();
  console.log('CHIPS:', JSON.stringify(chips));
  expect(chips.length).toBe(2);
  const txt = await hp.evaluate(() => document.body.innerText);
  expect(txt).toContain('[Azioni: TIMER]');
  await hp.screenshot({ path: 'tests/.shots/zz-verifica-strumenti-E.png', fullPage: true });
});
