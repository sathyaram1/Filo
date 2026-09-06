// Verifica indipendente (giro 5) — porte già trovate, ri-provate.
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

// Provider finto: `script` è la lista dei giri (uno per chiamata al modello).
// Registra i `messages` di ogni giro in globalThis.__rounds.
async function scriptProvider(app, script) {
  await app.evaluate(async (electron, s) => {
    globalThis.__rounds = [];
    globalThis.__toolDefs = null;
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, tools, onToolCall, onDelta }) => {
      globalThis.__rounds.push(JSON.parse(JSON.stringify(messages)));
      if (!globalThis.__toolDefs && tools) globalThis.__toolDefs = tools.map((t) => t.function && t.function.name);
      const step = s[Math.min(i, s.length - 1)];
      i += 1;
      const calls = (step.toolCalls || []).map((c) => ({ ...c, arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments || {}) }));
      if (step.text) { try { onDelta && onDelta(step.text); } catch (_) {} }
      for (const c of calls) { try { onToolCall && onToolCall(c); } catch (_) {} }
      return {
        text: step.text || '', toolCalls: calls, reasoningDetails: step.reasoningDetails || [],
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
  }, script);
}

async function ask(page, msg) {
  await page.locator('#input').fill(msg);
  await page.locator('#sendBtn').click();
}

function rows(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.dash-activity-row')).map((e) => e.textContent.trim()));
}

// ── 1. Cammino principale + la porta del giro 4: colore = riga E controllo ──
test('un turno solo: cerca, applica il colore, risponde — riga nel diario E controllo per la tinta', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: 'Cerco e sistemo il colore…', toolCalls: [
      { id: 'c1', name: 'CERCA_WEB', arguments: { query: 'blu accento' } },
      { id: 'c2', name: 'IMPOSTA_ESTETICA', arguments: { token: 'accent', valore: '#1a4fd0' } },
    ] },
    { text: 'Fatto, ho messo un blu.' },
  ]);

  await ask(page, "metti l'accento blu");

  // La risposta arriva.
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Fatto, ho messo un blu', { timeout: 20_000 });

  // Il colore è applicato DAVVERO.
  const settings = await app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
  expect(settings.themeTokens.accent).toBe('#1a4fd0');

  // Riga nel diario…
  const r = await rows(page);
  expect(r.join(' | ')).toMatch(/Aspetto · accent/);
  expect(r.join(' | ')).toMatch(/Cerco sul web/);

  // …E il controllo per aggiustare la tinta (era sparito al giro 4).
  await expect(page.locator('.sn-refine-trigger')).toBeVisible({ timeout: 8_000 });
  await page.locator('.sn-refine-trigger').click();
  await expect(page.locator('.sn-refine-overlay')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.sn-refine-color')).toBeVisible();

  // Riassunto in testa: conta ricerca e aspetto.
  const head = await page.locator('.dash-activity-label').last().textContent();
  expect(head).toMatch(/cercato sul web/i);
  expect(head).toMatch(/aspetto/i);
});

// ── 2. Appunto: riga nel diario E bottone che apre l'editor ──
test("appunto: riga nel diario E bottone che porta all'editor", async ({ app }) => {
  test.setTimeout(90_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: 'Segno.', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: { testo: 'comprare il pane', contesto: 'spesa' } }] },
    { text: 'Appuntato.' },
  ]);
  await ask(page, 'segna che devo comprare il pane');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Appuntato', { timeout: 20_000 });

  const r = await rows(page);
  expect(r.join(' | ')).toMatch(/Appunto salvato/);
  await expect(page.locator('.dash-action-btn[data-action="openNotes"]')).toBeVisible({ timeout: 8_000 });
});

// ── 3. Gli esiti che tornano al modello: eseguite, non «NON eseguite» ──
test('esiti al modello: le azioni senza bottone risultano ESEGUITE', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    // Prima le sveglie da spostare/cancellare, nello stesso turno.
    { text: 'Preparo.', toolCalls: [
      { id: 'p1', name: 'SVEGLIA', arguments: { time: '08:00', label: 'palestra' } },
      { id: 'p2', name: 'SVEGLIA', arguments: { time: '09:00', label: 'lezione' } },
    ] },
    { text: 'Faccio.', toolCalls: [
      { id: 't1', name: 'SALVA_APPUNTO', arguments: { testo: 'x', contesto: 'y' } },
      { id: 't2', name: 'SALVA_LEZIONE', arguments: { testo: "L'utente non beve caffè" } },
      { id: 't3', name: 'COMANDO_FINESTRA', arguments: { comando: 'home' } },
      { id: 't4', name: 'IMPOSTA_PREFERENZA', arguments: { chiave: 'tema', valore: 'scuro' } },
      { id: 't5', name: 'RIMUOVI_PROXY', arguments: {} },
      { id: 't6', name: 'MODIFICA_SVEGLIA', arguments: { etichetta: 'palestra', orario: '08:30' } },
      { id: 't7', name: 'CANCELLA_SVEGLIA', arguments: { etichetta: 'lezione' } },
    ] },
    { text: 'Tutto fatto.' },
  ]);
  await ask(page, 'fai tutto');

  await expect.poll(async () => (await app.evaluate(() => (globalThis.__rounds || []).length)), { timeout: 30_000 }).toBeGreaterThan(1);
  const second = await app.evaluate(() => globalThis.__rounds[1]);
  const byId = {};
  for (const m of second) if (m.role === 'tool') byId[m.tool_call_id] = m.content;

  for (const id of ['t1', 't2', 't3', 't4', 't6', 't7']) {
    expect(byId[id], `esito di ${id}`).toBeTruthy();
    expect(byId[id], `esito di ${id}: ${byId[id]}`).not.toMatch(/NON eseguita/i);
  }
  // Impostazione applicata: verbo al passato, non «Filo vuole impostare».
  expect(byId.t4).toMatch(/Impostazione applicata/i);
  expect(byId.t4).not.toMatch(/vuole impostare/i);
  // Togli proxy senza scheda web: l'esito deve dire che manca la scheda.
  expect(byId.t5, `esito RIMUOVI_PROXY: ${byId.t5}`).toMatch(/scheda/i);
});

// ── 4. Chiamate senza id dal fornitore: esiti distinti, nessuna riga doppia ──
test('due timer senza id: due esiti distinti, due righe, due timer', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: '', toolCalls: [
      { name: 'TIMER', arguments: { secondi: 120, etichetta: 'uova' } },
      { name: 'TIMER', arguments: { secondi: 300, etichetta: 'pasta' } },
    ] },
    { text: 'Due timer avviati.' },
  ]);
  await ask(page, 'timer uova 2 minuti e pasta 5 minuti');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Due timer avviati', { timeout: 20_000 });

  const second = await app.evaluate(() => globalThis.__rounds[1]);
  const toolMsgs = second.filter((m) => m.role === 'tool');
  expect(toolMsgs.length).toBe(2);
  expect(new Set(toolMsgs.map((m) => m.tool_call_id)).size).toBe(2);

  const r = await rows(page);
  const timerRows = r.filter((t) => /Timer avviato/.test(t));
  expect(timerRows.length).toBe(2);

  const timers = await app.evaluate(async () => globalThis.SN_FILO_MEM.listTimers());
  expect(timers.filter((t) => /uova|pasta/.test(t.label || '')).length).toBe(2);
});

// ── 5. Tetto dei giri: la chat dice che Filo si è fermato ──
test('al tetto dei giri la chat dice che Filo si è fermato', async ({ app }) => {
  test.setTimeout(180_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: 'ancora…', toolCalls: [{ name: 'CAPACITA_DETTAGLIO', arguments: { voce: 'timer' } }] },
  ]);
  await ask(page, 'gira a vuoto');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText(/mi sono fermato/i, { timeout: 120_000 });
});

// ── 6. Ultimo giro muto: la frase diventa la risposta, una volta sola ──
test('ultimo giro muto: la frase scritta con le azioni diventa la risposta, una sola volta', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: 'Ti metto la sveglia alle 7, buonanotte!', toolCalls: [{ id: 's1', name: 'SVEGLIA', arguments: { time: '07:00', label: 'mattina' } }] },
    { text: '' },
  ]);
  await ask(page, 'sveglia alle 7');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('buonanotte', { timeout: 20_000 });
  // Non deve comparire due volte (bolla + nota).
  const occurrences = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('.dash-bubble-filo, .dash-activity-note'));
    return all.filter((e) => /buonanotte/.test(e.textContent || '')).length;
  });
  expect(occurrences).toBe(1);
});
