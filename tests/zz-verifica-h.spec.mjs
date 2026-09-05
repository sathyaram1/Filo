// Verifica avversariale (temporaneo): popup di conferma da tastiera/shell; diario delle altre azioni.
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

async function findConfirm(app, page, shell) {
  const out = { pageOk: await page.getByRole('button', { name: 'OK' }).count(), shellOk: await shell.getByRole('button', { name: 'OK' }).count(), pageText: await page.getByText('Filo chiede conferma').count(), shellText: await shell.getByText('Filo chiede conferma').count(), wins: app.windows().map((w) => w.url()) };
  const host = await page.evaluate(() => { const h = document.querySelector('.sn-confirm-host'); return h ? { shadow: !!h.shadowRoot, mode: h.shadowRoot ? 'open' : 'closed-or-none', children: h.children.length, html: h.outerHTML.slice(0, 600) } : null; });
  return { ...out, host };
}

test('conferma di livello 2: OK e Annulla, e il diario dopo', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { text: 'Attivo il terminale.', toolCalls: [{ id: 'k1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modalita_terminale', valore: true }) }] },
    { text: 'CONF-FINE: dimmi tu.' },
  ]);
  await send(page, 'attiva il terminale');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'CONF-FINE' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  console.log('TROVA', JSON.stringify(await findConfirm(app, page, shell)));
  // Prova: bottone OK trovato da Playwright (attraversa gli shadow aperti).
  const ok = page.getByRole('button', { name: 'OK' });
  if (await ok.count()) { await ok.first().click(); console.log('CLICK', 'page-OK'); }
  else {
    const sok = shell.getByRole('button', { name: 'OK' });
    if (await sok.count()) { await sok.first().click(); console.log('CLICK', 'shell-OK'); }
    else { await page.keyboard.press('Enter'); console.log('CLICK', 'Enter'); }
  }
  await page.waitForTimeout(1500);
  const after = await app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
  const d = await dumpChat(page);
  console.log('CONF-DOPO', JSON.stringify({ terminal: after.terminal, bubbles: d.bubbles, actions: d.actions, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })), html: await page.evaluate(() => (document.getElementById('bubbles') || {}).innerHTML?.slice(-900)) }));
  expect(!!(after.terminal && after.terminal.enabled)).toBe(true);

  // Ora un turno dopo: il modello sa che è stata confermata?
  await installScript(app, [{ text: 'DOPO-CONF' }]);
  await send(page, 'è attivo?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'DOPO-CONF' })).toBeVisible({ timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__verCalls);
  const msgs = calls[0].messages;
  console.log('CONTESTO-DOPO-CONF', JSON.stringify(msgs.slice(1).map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 200), tc: m.tool_calls && m.tool_calls.map((c) => c.function.name) })), null, 1));
});

test('conferma di livello 2: Annulla', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { toolCalls: [{ id: 'k1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modalita_terminale', valore: true }) }] },
    { text: 'CONF2-FINE' },
  ]);
  await send(page, 'attiva il terminale');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'CONF2-FINE' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  const no = page.getByRole('button', { name: 'Annulla' });
  console.log('ANNULLA-COUNT', await no.count());
  if (await no.count()) await no.first().click(); else await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  const d = await dumpChat(page);
  console.log('RIFIUTO', JSON.stringify({ bubbles: d.bubbles, actions: d.actions, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })), hostLeft: await page.locator('.sn-confirm-host').count() }));
  const btn = page.locator('.dash-action-btn', { hasText: 'vuole impostare' });
  expect(await btn.count()).toBe(1);
  await btn.first().click();
  await page.waitForTimeout(800);
  console.log('RIAPERTO', JSON.stringify(await findConfirm(app, page, shell)));
  const ok = page.getByRole('button', { name: 'OK' });
  if (await ok.count()) await ok.first().click();
  await page.waitForTimeout(1000);
  const after = await app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
  console.log('DOPO-RIAPERTO', JSON.stringify({ terminal: after.terminal }));
});

test('diario: quali azioni restano senza riga', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await setup(app, shell);
  await testServer.openReady(openTab, '<h1>pagina</h1>');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 8_000 });
  await installScript(app, [
    { toolCalls: [
      { id: 'd1', name: 'IMPOSTA_ESTETICA', arguments: JSON.stringify({ token: 'accent', valore: '#aa3355' }) },
      { id: 'd2', name: 'REGOLA_PROXY_DOMINIO', arguments: JSON.stringify({ country: 'fr', dominio: 'example.org' }) },
      { id: 'd3', name: 'LEGGI_TRASPARENZA', arguments: JSON.stringify({ doc: 'models' }) },
      { id: 'd4', name: 'LEGGI_FILE', arguments: JSON.stringify({ fileId: 'non-esiste' }) },
      { id: 'd5', name: 'LEGGI_DOCUMENTO', arguments: JSON.stringify({ percorso: '~/non-esiste-davvero.txt' }) },
      { id: 'd6', name: 'RIMUOVI_REGOLA_PROXY', arguments: JSON.stringify({ dominio: 'example.org' }) },
      { id: 'd7', name: 'SALVA_APPUNTO', arguments: JSON.stringify({ testo: 'latte', contesto: 'spesa' }) },
      { id: 'd8', name: 'SALVA_LEZIONE', arguments: JSON.stringify({ testo: 'L’utente preferisce il tè' }) },
      { id: 'd9', name: 'EVENTO_CALENDARIO', arguments: JSON.stringify({ data: '2026-09-10', ora: '10:00', titolo: 'Dentista' }) },
    ] },
    { text: 'DIARIO-FINE' },
  ]);
  await send(page, 'fai tutto');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'DIARIO-FINE' })).toBeVisible({ timeout: 30_000 });
  const calls = await app.evaluate(() => globalThis.__verCalls);
  const res = {};
  for (const m of toolMsgs(calls[1])) res[m.tool_call_id] = String(m.content).slice(0, 160);
  console.log('DIARIO-ESITI', JSON.stringify(res, null, 1));
  const d = await dumpChat(page);
  console.log('DIARIO-DOM', JSON.stringify({ actions: d.actions, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })) }));
  const tabs = await shell.locator('.tab').count();
  console.log('DIARIO-TABS', tabs, JSON.stringify(app.windows().map((w) => w.url())));
});
