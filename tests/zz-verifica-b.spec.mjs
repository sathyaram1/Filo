// Verifica avversariale (temporaneo): le porte dei giri passati, ri-provate.
import { test, expect } from './fixtures/electron.mjs';
import { newtabPage, configureModel, installScript, dumpChat } from './zz-verifica-helpers.mjs';

async function setup(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  return page;
}

async function send(page, text) {
  await page.locator('#input').fill(text);
  await page.locator('#sendBtn').click();
}

const toolMsgs = (call) => call.messages.filter((m) => m.role === 'tool');

test('giro muto: la frase scritta insieme all’azione resta la risposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { text: 'Ti metto la sveglia alle 7, buonanotte!', toolCalls: [{ id: 'c1', name: 'SVEGLIA', arguments: JSON.stringify({ time: '07:00', label: 'mattina' }) }] },
    { text: '' },
  ]);
  await send(page, 'sveglia alle 7');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'buonanotte' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-bubble-streaming')).toHaveCount(0, { timeout: 3_000 });
  const d = await dumpChat(page);
  console.log('MUTO', JSON.stringify({ bubbles: d.bubbles, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })) }));
  // La frase è una bolla vera, fuori dal blocco.
  expect(d.bubbles.some((b) => b.includes('buonanotte'))).toBe(true);
  expect(d.bubbles.some((b) => b.includes('(vuoto)'))).toBe(false);
  const timers = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.some((t) => t.kind === 'alarm')).toBe(true);
});

test('porte del giro 1: esiti «eseguita», diario di sveglia spostata e cancellata', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { toolCalls: [
      { id: 'a1', name: 'SVEGLIA', arguments: JSON.stringify({ time: '07:00', label: 'palestra' }) },
      { id: 'a2', name: 'SALVA_APPUNTO', arguments: JSON.stringify({ testo: 'comprare il latte', contesto: 'spesa' }) },
      { id: 'a3', name: 'SALVA_LEZIONE', arguments: JSON.stringify({ testo: 'L’utente non beve caffè' }) },
      { id: 'a4', name: 'ONBOARDING', arguments: JSON.stringify({ spunta: ['profilo'] }) },
      { id: 'a5', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'tema', valore: 'scuro' }) },
      { id: 'a6', name: 'COMANDO_FINESTRA', arguments: JSON.stringify({ comando: 'home' }) },
      { id: 'a7', name: 'RIMUOVI_PROXY', arguments: '{}' },
      { id: 'a8', name: 'RIMUOVI_PROXY_TUTTE', arguments: '{}' },
    ] },
    { toolCalls: [{ id: 'b1', name: 'MODIFICA_SVEGLIA', arguments: JSON.stringify({ etichetta: 'palestra', orario: '08:00' }) }] },
    { toolCalls: [{ id: 'c1', name: 'CANCELLA_SVEGLIA', arguments: JSON.stringify({ etichetta: 'palestra' }) }] },
    { text: 'PORTE-FINE' },
  ]);
  await send(page, 'fai tutte queste cose');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'PORTE-FINE' })).toBeVisible({ timeout: 30_000 });
  const calls = await app.evaluate(() => globalThis.__verCalls);
  expect(calls.length).toBe(4);
  const results = {};
  for (const c of calls.slice(1)) for (const m of toolMsgs(c)) results[m.tool_call_id] = m.content;
  console.log('ESITI', JSON.stringify(results, null, 1));
  for (const [id, content] of Object.entries(results)) {
    expect(content, id).not.toMatch(/NON eseguita/i);
    expect(content, id).not.toMatch(/vuole impostare/i);
    expect(content, id).not.toMatch(/\.\.$/);
  }
  const d = await dumpChat(page);
  console.log('PORTE-DOM', JSON.stringify({ bubbles: d.bubbles, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })) }));
  const rows = d.activities.flatMap((a) => a.rows).join(' | ');
  expect(rows).toMatch(/spostat|modificat/i);
  expect(rows).toMatch(/cancellat|tolt|rimoss/i);
  expect(d.activities[0].head).toMatch(/spostat|modificat/i);
  expect(d.activities[0].head).toMatch(/cancellat|tolt|rimoss/i);
  const timers = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.some((t) => /palestra/i.test(t.label || ''))).toBe(false);
  const settings = await app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
  expect(settings.theme).toBe('dark');
  const lessons = await app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.getLessonsBuffer()));
  expect(lessons).toContain('caffè');
});

test('stile della pagina su una scheda web vera, poi ripristino', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await setup(app, shell);
  const web = await testServer.openReady(openTab, '<h1 id="t">Titolo</h1><p>testo</p>');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 8_000 });
  await installScript(app, [
    { toolCalls: [{ id: 's1', name: 'STILE_PAGINA', arguments: JSON.stringify({ regole: [{ selettore: 'h1', css: 'color: rgb(255, 0, 0)' }], descrizione: 'titoli rossi' }) }] },
    { text: 'STILE-FINE' },
  ]);
  await send(page, 'metti i titoli in rosso');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'STILE-FINE' })).toBeVisible({ timeout: 20_000 });
  const color = await web.evaluate(() => getComputedStyle(document.getElementById('t')).color);
  const calls = await app.evaluate(() => globalThis.__verCalls);
  const res = toolMsgs(calls[1]).map((m) => m.content);
  console.log('STILE', JSON.stringify({ color, res }));
  expect(color).toBe('rgb(255, 0, 0)');
  expect(res[0]).not.toMatch(/NON eseguita/i);
  await installScript(app, [
    { toolCalls: [{ id: 's2', name: 'RIPRISTINA_STILE_PAGINA', arguments: '{}' }] },
    { text: 'RIPRISTINO-FINE' },
  ]);
  await send(page, 'rimetti com’era');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RIPRISTINO-FINE' })).toBeVisible({ timeout: 20_000 });
  const color2 = await web.evaluate(() => getComputedStyle(document.getElementById('t')).color);
  const calls2 = await app.evaluate(() => globalThis.__verCalls);
  console.log('RIPRISTINO', JSON.stringify({ color2, res: toolMsgs(calls2[1]).map((m) => m.content) }));
  expect(color2).not.toBe('rgb(255, 0, 0)');
});

test('chiamate senza id: esiti allineati, niente righe doppie', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { toolCalls: [
      { name: 'TIMER', arguments: JSON.stringify({ secondi: 120, etichetta: 'uova' }) },
      { name: 'TIMER', arguments: JSON.stringify({ secondi: 300, etichetta: 'tè' }) },
    ] },
    { text: 'NOID-FINE' },
  ]);
  await send(page, 'timer uova 2 minuti e tè 5 minuti');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'NOID-FINE' })).toBeVisible({ timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__verCalls);
  const asst = calls[1].messages.filter((m) => m.role === 'assistant' && m.tool_calls).pop();
  const tms = toolMsgs(calls[1]);
  console.log('NOID', JSON.stringify({ asst: asst && asst.tool_calls, tms }));
  expect(asst.tool_calls.length).toBe(2);
  expect(tms.length).toBe(2);
  expect(new Set(tms.map((m) => m.tool_call_id)).size).toBe(2);
  expect(tms.map((m) => m.tool_call_id).sort()).toEqual(asst.tool_calls.map((c) => c.id).sort());
  const d = await dumpChat(page);
  console.log('NOID-DOM', JSON.stringify(d.activities.map((a) => ({ head: a.head, rows: a.rows }))));
  const timerRows = d.activities.flatMap((a) => a.rows).filter((r) => /timer/i.test(r));
  expect(timerRows.length).toBe(2);
  const timers = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.length).toBe(2);
});

test('tetto dei giri: Filo dice che si è fermato', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { toolCalls: [{ id: 'loop', name: 'CAPACITA_DETTAGLIO', arguments: JSON.stringify({ ids: ['home'] }) }] },
  ]);
  await send(page, 'vai in loop');
  await expect(page.locator('.dash-bubble-streaming')).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(async () => (await app.evaluate(() => globalThis.__verIdx)), { timeout: 60_000 }).toBeGreaterThan(5);
  await page.waitForTimeout(3000);
  const idx = await app.evaluate(() => globalThis.__verIdx);
  const d = await dumpChat(page);
  console.log('TETTO', JSON.stringify({ idx, bubbles: d.bubbles, acts: d.activities.map((a) => ({ head: a.head, nrows: a.rows.length, notes: a.notes })) }));
  expect(idx).toBeLessThanOrEqual(13);
  const all = d.bubbles.join(' ') + ' ' + d.activities.map((a) => a.head + ' ' + a.notes.join(' ')).join(' ');
  expect(all).toMatch(/fermat|interrott|limite|troppi/i);
});
