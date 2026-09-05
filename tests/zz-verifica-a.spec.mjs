// Verifica avversariale (temporaneo): cammino principale degli strumenti nativi.
import { test, expect } from './fixtures/electron.mjs';
import { newtabPage, configureModel, installScript, dumpChat } from './zz-verifica-helpers.mjs';

test('un turno: cerca, legge capacità, sveglia+timer, poi risponde — in diretta', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const logs = [];
  try { app.process().stdout.on('data', (d) => logs.push('[out] ' + d)); } catch (_) {}
  try { app.process().stderr.on('data', (d) => logs.push('[err] ' + d)); } catch (_) {}
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

  const plog = [];
  page.on('console', (m) => plog.push(m.type() + ': ' + m.text()));
  await page.locator('#input').fill('cerca il meteo di Roma domani, dimmi come si traduce una pagina e mettimi la sveglia alle 7 e un timer di 10 minuti');
  await page.locator('#sendBtn').click();

  // In diretta: mentre lavora (prima della risposta) il blocco di attività c'è già.
  const live = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 3500) {
    const d = await dumpChat(page);
    d.idx = await app.evaluate(() => globalThis.__verIdx);
    d.t = Date.now() - t0;
    live.push(d);
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log('PAGELOG', JSON.stringify(plog.slice(-30), null, 1));
  console.log('CONTAINER', await page.evaluate(() => { const b = document.querySelector('.dash-bubble-filo'); return b ? b.parentElement.parentElement.outerHTML.slice(0, 4000) : 'nessuna bolla'; }));
  console.log('LIVE-SAMPLES', JSON.stringify(live.map((d) => ({ t: d.t, idx: d.idx, heads: d.activities.map((a) => a.head), rows: d.activities.map((a) => a.rows), notes: d.activities.map((a) => a.notes), bubbles: d.bubbles })), null, 1));

  console.log('PRE', JSON.stringify(await app.evaluate(() => ({ err: globalThis.__verErr, idx: globalThis.__verIdx, n: globalThis.__verCalls.length, tools: globalThis.__verCalls[0] && globalThis.__verCalls[0].toolsNames, last: globalThis.__verCalls[0] && globalThis.__verCalls[0].messages.slice(-1) }))));
  console.log('LOGS', logs.join('').slice(-3000));
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
