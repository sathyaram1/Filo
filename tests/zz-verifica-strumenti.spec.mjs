// Spec TEMPORANEO della verifica indipendente (strumenti nativi della chat).
// Il modello è simulato nel main: ogni giro segue un copione (script) e le
// richieste ricevute vengono registrate in globalThis.__calls.
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
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_LESSON]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Copione: array di passi { reasoning, text, toolCalls, reasoningDetails, throw, delayMs, chunkDelayMs }.
// Ogni chiamata al provider consuma un passo (l'ultimo si ripete).
async function installProvider(app, script) {
  await app.evaluate(async ({}, script) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    globalThis.__calls = [];
    const run = async ({ attempts, messages, tools, onDelta, onReasoning, onToolCall }) => {
      const idx = globalThis.__calls.length;
      const step = script[Math.min(idx, script.length - 1)];
      globalThis.__calls.push({
        messages: JSON.parse(JSON.stringify(messages)),
        toolNames: (tools || []).map((t) => t.function && t.function.name),
        hasTools: Array.isArray(tools) && tools.length > 0,
        streaming: !!(onDelta || onReasoning || onToolCall),
      });
      if (step.delayMs) await sleep(step.delayMs);
      if (step.throw) { const e = new Error(step.throw); e.status = 500; e.provider = 'openrouter'; throw e; }
      if (step.reasoning) {
        for (const w of String(step.reasoning).split(' ')) { try { onReasoning && onReasoning(`${w} `); } catch (_) {} await sleep(20); }
      }
      for (const c of step.toolCalls || []) {
        try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {}
        if (step.toolDelayMs) await sleep(step.toolDelayMs);
      }
      if (step.text) {
        const t = String(step.text);
        const n = Math.max(1, Math.ceil(t.length / 3));
        for (let i = 0; i < 3; i++) {
          const chunk = t.slice(i * n, (i + 1) * n);
          if (chunk) { try { onDelta && onDelta(chunk); } catch (_) {} }
          if (step.chunkDelayMs) await sleep(step.chunkDelayMs);
        }
      }
      return {
        text: step.text || '',
        toolCalls: step.toolCalls || [],
        reasoningDetails: step.reasoningDetails || [],
        finishReason: (step.toolCalls || []).length ? 'tool_calls' : 'stop',
        model: attempts[0].model, provider: attempts[0].provider,
        usage: { promptTokens: 120, completionTokens: 30, cachedPromptTokens: 0 },
      };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = run;
    globalThis.SN_PROVIDERS.completeWithFallback = run;
  }, script);
}

async function installSearch(app, results) {
  await app.evaluate(async ({}, results) => {
    globalThis.__searches = [];
    globalThis.SN_WEB_SEARCH.search = async ({ query }) => {
      globalThis.__searches.push(query);
      return { results, provider: 'test' };
    };
  }, results);
}

const calls = (app) => app.evaluate(() => globalThis.__calls);
const timers = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
const history = (app) => app.evaluate(async () => (await globalThis.SN_HISTORY.list()).filter((h) => h.action === 'filo_chat'));

async function sendChat(page, text) {
  await page.locator('#input').fill(text);
  await page.locator('#sendBtn').click();
}

const SEARCH_RESULTS = [
  { title: 'Meteo Roma domani', url: 'https://example.com/meteo-roma', snippet: 'Domani sole fino alle 15:00, poi pioggia.' },
  { title: 'Previsioni <script>alert(1)</script>', url: 'https://example.com/x?q=<b>bold</b>', snippet: '<img src=x onerror=alert(2)> testo' },
];

test('cerca → legge → sveglia → risposta in UN turno, con diario in diretta', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installSearch(app, SEARCH_RESULTS);
  await installProvider(app, [
    // giro 1: ragiona, dice cosa fa, cerca
    { reasoning: 'Devo cercare quando piove a Roma domani.', text: 'Cerco il meteo di domani…', chunkDelayMs: 50,
      toolCalls: [{ id: 'call_1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'meteo Roma domani' }) }],
      reasoningDetails: [{ type: 'reasoning.text', text: 'pensiero-giro-1' }], toolDelayMs: 1200 },
    // giro 2: imposta la sveglia in base ai risultati
    { reasoning: 'Piove alle 15, sveglia alle 14:30.',
      toolCalls: [{ id: 'call_2', name: 'SVEGLIA', arguments: JSON.stringify({ time: '14:30', label: 'pioggia' }) }],
      reasoningDetails: [{ type: 'reasoning.text', text: 'pensiero-giro-2' }], toolDelayMs: 800 },
    // giro 3: risposta finale, testo semplice in streaming
    { text: 'INIZIO-RISPOSTA domani a Roma piove dalle 15: sveglia alle 14:30 impostata. FINE-RISPOSTA', chunkDelayMs: 300,
      reasoningDetails: [{ type: 'reasoning.text', text: 'pensiero-giro-3' }] },
  ]);

  await sendChat(page, 'cerca quando piove domani a Roma e mettimi una sveglia mezz\'ora prima');

  // In diretta: appena il modello nomina la ricerca, la riga in testa lo dice.
  await expect(page.locator('.dash-activity-label')).toHaveText(/Cerco sul web/, { timeout: 6_000 });
  // Poi la sveglia.
  await expect(page.locator('.dash-activity-label')).toHaveText(/sveglia/i, { timeout: 10_000 });
  // Il testo finale scorre in diretta come testo semplice (non JSON).
  await expect.poll(async () => page.evaluate(() => {
    const b = document.querySelector('.dash-bubble-streaming');
    if (!b) return null;
    const t = b.textContent || '';
    return { head: t.includes('INIZIO-RISPOSTA'), tail: t.includes('FINE-RISPOSTA') };
  }), { timeout: 8_000, intervals: [40] }).toEqual({ head: true, tail: false });

  await expect(page.locator('.dash-bubble-filo', { hasText: 'FINE-RISPOSTA' })).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.dash-activity[data-phase="done"]')).toHaveCount(1, { timeout: 5_000 });

  // Riassunto in testa e contenuto del diario.
  const label = await page.locator('.dash-activity-label').textContent();
  expect(label).toMatch(/Ha cercato sul web e impostato una sveglia/);
  await page.locator('.dash-activity-head').click();
  const body = page.locator('.dash-activity-body');
  await expect(body).toBeVisible();
  const bodyText = await body.textContent();
  expect(bodyText).toContain('Devo cercare quando piove');
  expect(bodyText).toContain('Cerco il meteo di domani…');          // nota di lavoro nel diario
  expect(bodyText).toContain('Cerco sul web: meteo Roma domani');   // riga della ricerca
  expect(bodyText).toContain('Sveglia impostata · 14:30 · pioggia');
  expect(bodyText).toContain('Piove alle 15');
  // La nota di lavoro NON resta come bolla in chat.
  const filoBubbles = await page.locator('.dash-bubble-filo').allTextContents();
  expect(filoBubbles.filter((t) => t.includes('Cerco il meteo di domani')).length).toBe(0);
  expect(filoBubbles.length).toBe(1);
  // Nessuna riga duplicata nel diario.
  expect((bodyText.match(/Cerco sul web: meteo Roma domani/g) || []).length).toBe(1);
  expect((bodyText.match(/Sveglia impostata/g) || []).length).toBe(1);
  // Nessun JSON in chat, nessuna esecuzione di script dal risultato.
  expect(filoBubbles[0]).not.toMatch(/"actions"|tool_call/);

  // La sveglia esiste davvero.
  const tl = await timers(app);
  expect(tl.some((t) => t.label === 'pioggia')).toBe(true);
  // La ricerca è stata eseguita una volta sola.
  expect(await app.evaluate(() => globalThis.__searches)).toEqual(['meteo Roma domani']);

  // Il modello ha ricevuto gli esiti come messaggi 'tool', con gli id giusti,
  // e il suo stesso ragionamento strutturato.
  const c = await calls(app);
  expect(c.length).toBe(3);
  expect(c[0].hasTools).toBe(true);
  expect(c[0].toolNames).toEqual(expect.arrayContaining(['CERCA_WEB', 'SVEGLIA', 'NAVIGA', 'LEGGI_DOCUMENTO']));
  expect(c[0].toolNames).not.toContain('ONBOARDING');
  const m2 = c[1].messages;
  const asst2 = m2[m2.length - 2];
  const tool2 = m2[m2.length - 1];
  expect(asst2.role).toBe('assistant');
  expect(asst2.tool_calls[0].id).toBe('call_1');
  expect(asst2.tool_calls[0].function.name).toBe('CERCA_WEB');
  expect(asst2.reasoning_details).toEqual([{ type: 'reasoning.text', text: 'pensiero-giro-1' }]);
  expect(tool2.role).toBe('tool');
  expect(tool2.tool_call_id).toBe('call_1');
  expect(tool2.content).toContain('https://example.com/meteo-roma');
  expect(tool2.content).toContain('Domani sole fino alle 15:00');
  const m3 = c[2].messages;
  expect(m3[m3.length - 1].role).toBe('tool');
  expect(m3[m3.length - 1].tool_call_id).toBe('call_2');
  expect(m3[m3.length - 1].content).toMatch(/Eseguita/);
  expect(m3[m3.length - 2].reasoning_details).toEqual([{ type: 'reasoning.text', text: 'pensiero-giro-2' }]);
  // Il testo del giro 1 è rimasto nel messaggio dell'assistente.
  expect(asst2.content).toBe('Cerco il meteo di domani…');

  // Cronologia AI: una voce per giro, con le misure.
  const h = await history(app);
  expect(h.length).toBe(3);
  for (const it of h) {
    expect(it.timing && it.timing.totalMs > 0).toBe(true);
  }
  const outs = h.map((x) => x.output).join('\n');
  expect(outs).toContain('[Azioni: CERCA_WEB]');
  expect(outs).toContain('[Azioni: SVEGLIA]');
  expect(h.some((x) => x.timing.firstReasoningMs != null)).toBe(true);
  expect(h.some((x) => x.timing.firstToolMs != null)).toBe(true);
  expect(h.some((x) => x.timing.firstTextMs != null)).toBe(true);

  await page.screenshot({ path: 'tests/.shots/zz-verifica-strumenti-1.png' });

  // ── Secondo messaggio: il ragionamento dell'ultimo giro torna al modello,
  // e gli esiti delle azioni del turno passato restano nel contesto.
  await installProvider(app, [{ text: 'Seconda risposta.' }]);
  await sendChat(page, 'grazie, e quanto dura la pioggia?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Seconda risposta.' })).toBeVisible({ timeout: 8_000 });
  const c2 = await calls(app);
  const msgs = c2[0].messages;
  const prevAsst = msgs.filter((m) => m.role === 'assistant');
  expect(prevAsst.length).toBeGreaterThanOrEqual(1);
  const last = prevAsst[prevAsst.length - 1];
  expect(last.reasoning_details).toEqual([{ type: 'reasoning.text', text: 'pensiero-giro-3' }]);
  expect(last.content).toContain('INIZIO-RISPOSTA');
  expect(last.content).toContain('https://example.com/meteo-roma');
  // Un turno senza azioni non crea un blocco di attività vuoto (o lo toglie).
  const acts = await page.locator('.dash-activity').count();
  expect(acts).toBe(1);
});

test('cancellare e spostare una sveglia dalla chat: esito vero al modello e riga nel diario', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.addAlarm({ label: 'palestra', time: '23:59' }); });
  await installProvider(app, [
    { toolCalls: [{ id: 'c1', name: 'MODIFICA_SVEGLIA', arguments: JSON.stringify({ etichetta: 'palestra', orario: '23:50' }) }] },
    { toolCalls: [{ id: 'c2', name: 'CANCELLA_SVEGLIA', arguments: JSON.stringify({ etichetta: 'palestra' }) }] },
    { text: 'Spostata e poi tolta.' },
  ]);
  await sendChat(page, 'sposta la sveglia della palestra alle 23:50 e poi cancellala');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Spostata e poi tolta.' })).toBeVisible({ timeout: 10_000 });
  const tl = await timers(app);
  expect(tl.some((t) => t.label === 'palestra')).toBe(false);
  const c = await calls(app);
  const toolMsgs = c[2].messages.filter((m) => m.role === 'tool');
  console.log('ESITI AL MODELLO:', JSON.stringify(toolMsgs));
  // Il modello deve sapere che l'azione È riuscita.
  expect(toolMsgs[0].content).not.toMatch(/NON eseguita/);
  expect(toolMsgs[1].content).not.toMatch(/NON eseguita/);
  expect(toolMsgs[0].content).toMatch(/Spostat/);
  expect(toolMsgs[1].content).toMatch(/Tolt/);
  await page.locator('.dash-activity-head').click();
  const bodyText = await page.locator('.dash-activity-body').textContent();
  console.log('DIARIO:', bodyText);
  expect(bodyText).toMatch(/Spostata/);
  expect(bodyText).toMatch(/Cancellata/);
  const label = await page.locator('.dash-activity-label').textContent();
  expect(label).toMatch(/spostato una sveglia e cancellato una sveglia/);
});

test('azione con conferma (impostazione sensibile) dentro il giro: popup e esito onesto', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installProvider(app, [
    { toolCalls: [{ id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modalita_terminale', valore: true }) }] },
    { text: 'Ti ho chiesto conferma per il terminale.' },
  ]);
  await sendChat(page, 'attiva la modalità terminale');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ti ho chiesto conferma' })).toBeVisible({ timeout: 10_000 });
  const c = await calls(app);
  const toolMsg = c[1].messages[c[1].messages.length - 1];
  expect(toolMsg.role).toBe('tool');
  expect(toolMsg.content).toMatch(/In attesa della conferma/);
  // Il popup si apre da solo e, all'OK, l'impostazione cambia davvero.
  const host = page.locator('.sn-confirm-host');
  await expect(host).toHaveCount(1, { timeout: 5_000 });
  const okBtn = page.locator('.sn-confirm-btn-ok');
  if (await okBtn.count()) await okBtn.click();
  else await page.evaluate(() => { const h = document.querySelector('.sn-confirm-host'); const b = h && h.shadowRoot && h.shadowRoot.querySelector('.sn-confirm-btn-ok'); b && b.click(); });
  await expect.poll(async () => app.evaluate(async () => { const s = await globalThis.SN_STORAGE.getSettings(); return !!(s.terminal && s.terminal.enabled); }), { timeout: 5_000 }).toBe(true);
  await page.screenshot({ path: 'tests/.shots/zz-verifica-strumenti-conferma.png' });
});

test('argomenti rotti → errore al modello, che riprova; formato vecchio (JSON) ancora tollerato', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installProvider(app, [
    { toolCalls: [{ id: 'b1', name: 'TIMER', arguments: '{"secondi": 6' }] },
    { toolCalls: [{ id: 'b2', name: 'TIMER', arguments: JSON.stringify({ secondi: 600, etichetta: 'pasta' }) }] },
    { text: 'Timer pasta avviato.' },
  ]);
  await sendChat(page, 'timer pasta 10 minuti');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Timer pasta avviato.' })).toBeVisible({ timeout: 10_000 });
  const c = await calls(app);
  const t1 = c[1].messages[c[1].messages.length - 1];
  expect(t1.role).toBe('tool');
  expect(t1.tool_call_id).toBe('b1');
  expect(t1.content).toMatch(/NON eseguita/);
  const tl = await timers(app);
  expect(tl.filter((t) => t.label === 'pasta').length).toBe(1);
  await page.locator('.dash-activity-head').click();
  const bodyText = await page.locator('.dash-activity-body').textContent();
  expect(bodyText).toMatch(/Timer avviato · pasta · 10 min/);
  expect((bodyText.match(/Timer avviato/g) || []).length).toBe(1);

  // Formato vecchio: JSON nel testo, nessuna chiamata.
  await installProvider(app, [
    { text: JSON.stringify({ text: 'Ecco il link.', actions: [{ type: 'NAVIGA', url: 'https://example.com/legacy', label: 'Legacy' }] }) },
  ]);
  await sendChat(page, 'apri example legacy');
  await expect(page.locator('.dash-bubble-actions .dash-action-btn', { hasText: 'Legacy' })).toBeVisible({ timeout: 10_000 });
  const bubbles = await page.locator('.dash-bubble-filo').allTextContents();
  expect(bubbles.some((t) => t.includes('"actions"'))).toBe(false);
  expect(bubbles.some((t) => t.includes('Ecco il link.'))).toBe(true);
});

test('loop di azioni senza fine: si ferma; errore a metà giro: bolla d’errore con Riprova', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installSearch(app, SEARCH_RESULTS);
  await installProvider(app, [
    { text: 'ancora…', toolCalls: [{ id: 'l', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'loop' }) }] },
  ]);
  await sendChat(page, 'cerca all\'infinito');
  await expect(page.locator('.dash-activity[data-phase="done"]')).toHaveCount(1, { timeout: 40_000 });
  const c = await calls(app);
  expect(c.length).toBeLessThanOrEqual(12);
  expect(await page.locator('#sendBtn').isDisabled()).toBe(false);
  const label = await page.locator('.dash-activity-label').textContent();
  console.log('LABEL LOOP:', label);
  const bubbles = await page.locator('.dash-bubble-filo').allTextContents();
  console.log('BOLLE LOOP:', JSON.stringify(bubbles));

  // Errore al secondo giro.
  await installSearch(app, SEARCH_RESULTS);
  await installProvider(app, [
    { reasoning: 'Cerco prima.', toolCalls: [{ id: 'e1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'errore' }) }] },
    { throw: 'OpenRouter 500: boom' },
  ]);
  await sendChat(page, 'cerca e poi rompiti');
  await expect(page.locator('.dash-action-btn', { hasText: 'Riprova' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-activity[data-failed="1"]')).toHaveCount(1);
  expect(await page.locator('#sendBtn').isDisabled()).toBe(false);
  // Riprova: stavolta va.
  await installProvider(app, [{ text: 'Ora funziona.' }]);
  await page.locator('.dash-action-btn', { hasText: 'Riprova' }).click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ora funziona.' })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'tests/.shots/zz-verifica-strumenti-errore.png' });
});

test('stress: messaggio lunghissimo, emoji, HTML nei risultati; cronologia mostra le misure', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installSearch(app, SEARCH_RESULTS);
  await installProvider(app, [
    { reasoning: '🤔 penso', text: '<b>nota</b> 🍝', toolCalls: [{ id: 's1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: '<script>alert(1)</script> 🍕' }) }] },
    { text: 'Risposta <i>finale</i> 🎉 con [link](https://example.com/x?q=<b>bold</b>)' },
  ]);
  const long = 'a'.repeat(10_000) + ' 🍕 <script>alert(3)</script>';
  await sendChat(page, long);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.dash-activity-head').click();
  const bodyText = await page.locator('.dash-activity-body').textContent();
  expect(bodyText).toContain('Cerco sul web: <script>alert(1)</script> 🍕');
  expect(bodyText).toContain('<b>nota</b> 🍝');
  expect(await page.locator('.dash-activity-body script, .dash-activity-body b, .dash-bubble-filo script').count()).toBe(0);
  const c = await calls(app);
  expect(c[0].messages[c[0].messages.length - 1].content.length).toBeGreaterThan(9_000);
  await page.screenshot({ path: 'tests/.shots/zz-verifica-strumenti-stress.png' });

  // Cronologia AI: la voce del giro con azioni ha le misure e le azioni.
  const hp = await openTab('filo://history/history.html');
  await expect(hp.locator('.sn-history-item').first()).toBeVisible({ timeout: 8_000 });
  const chips = await hp.locator('.sn-history-timing').allTextContents();
  console.log('CHIP TEMPI:', JSON.stringify(chips));
  expect(chips.length).toBeGreaterThanOrEqual(2);
  expect(chips[0]).toMatch(/ragiona .* · scrive .* · fine .*s/);
  const outs = await hp.locator('.sn-history-output').allTextContents();
  expect(outs.some((t) => t.includes('[Azioni: CERCA_WEB]'))).toBe(true);
  await hp.screenshot({ path: 'tests/.shots/zz-verifica-strumenti-history.png' });
});
