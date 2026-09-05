// Verifica avversariale (temporaneo): popup di conferma, URL javascript:, contesto del Riprova, tema scuro.
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

const shadowDump = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.sn-confirm-host')).map((h) => ({
  cls: h.className, text: (h.textContent || '').slice(0, 200), shadow: h.shadowRoot ? h.shadowRoot.innerHTML.slice(0, 2500) : null,
  buttons: h.shadowRoot ? Array.from(h.shadowRoot.querySelectorAll('button')).map((b) => b.textContent.trim()) : [],
})));

test('conferma di livello 2: il popup e il suo bottone', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { text: 'Attivo il terminale.', toolCalls: [{ id: 'k1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modalita_terminale', valore: true }) }] },
    { text: 'CONF-FINE: dimmi tu.' },
  ]);
  await send(page, 'attiva il terminale');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'CONF-FINE' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  const sd = await shadowDump(page);
  console.log('SHADOW', JSON.stringify(sd, null, 1));
  // Premi il bottone di conferma nel popup.
  const pressed = await page.evaluate(() => {
    for (const h of document.querySelectorAll('.sn-confirm-host')) {
      const btns = h.shadowRoot ? Array.from(h.shadowRoot.querySelectorAll('button')) : [];
      const ok = btns.find((b) => /conferma|attiva|sì|ok|procedi/i.test(b.textContent)) || btns[0];
      if (ok) { ok.click(); return ok.textContent.trim(); }
    }
    return null;
  });
  console.log('PRESSED', pressed);
  await page.waitForTimeout(1500);
  const after = await app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
  const d = await dumpChat(page);
  console.log('CONF-DOPO', JSON.stringify({ terminal: after.terminal, bubbles: d.bubbles, actions: d.actions, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })), hosts: (await shadowDump(page)).length }));
  expect(!!(after.terminal && after.terminal.enabled)).toBe(true);
  // Il diario registra la conferma?
  console.log('CONF-HTML3', await page.evaluate(() => (document.getElementById('bubbles') || {}).innerHTML?.slice(-1500)));
});

test('conferma di livello 2 rifiutata: cosa vede l’utente', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { toolCalls: [{ id: 'k1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modalita_terminale', valore: true }) }] },
    { text: 'CONF2-FINE' },
  ]);
  await send(page, 'attiva il terminale');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'CONF2-FINE' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  const pressed = await page.evaluate(() => {
    for (const h of document.querySelectorAll('.sn-confirm-host')) {
      const btns = h.shadowRoot ? Array.from(h.shadowRoot.querySelectorAll('button')) : [];
      const no = btns.find((b) => /annulla|no|chiudi|rifiuta/i.test(b.textContent));
      if (no) { no.click(); return no.textContent.trim(); }
    }
    return null;
  });
  console.log('PRESSED-NO', pressed);
  await page.waitForTimeout(1000);
  const d = await dumpChat(page);
  console.log('RIFIUTO', JSON.stringify({ bubbles: d.bubbles, actions: d.actions, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })), hosts: (await shadowDump(page)).length }));
  // Il bottone in chat dovrebbe permettere di riaprire la conferma.
  const btn = page.locator('.dash-action-btn', { hasText: 'vuole impostare' });
  console.log('BTN-RESTA', await btn.count());
  if (await btn.count()) {
    await btn.first().evaluate((b) => b.click());
    await page.waitForTimeout(800);
    console.log('RIAPERTO', JSON.stringify((await shadowDump(page)).map((h) => h.buttons)));
  }
});

test('NAVIGA con URL javascript: il bottone in chat', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { toolCalls: [{ id: 'x8', name: 'NAVIGA', arguments: JSON.stringify({ url: 'javascript:alert(1)', etichetta: 'js' }) }, { id: 'x9', name: 'NAVIGA', arguments: JSON.stringify({ url: 'file:///C:/Windows/win.ini', etichetta: 'file' }) }] },
    { text: 'JS-FINE' },
  ]);
  await send(page, 'apri');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'JS-FINE' })).toBeVisible({ timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__verCalls);
  console.log('JS-ESITI', JSON.stringify(calls[1].messages.filter((m) => m.role === 'tool').map((m) => m.content)));
  const d = await dumpChat(page);
  console.log('JS-DOM', JSON.stringify({ actions: d.actions, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows })) }));
  page.on('dialog', (dlg) => { console.log('DIALOG', dlg.message()); dlg.dismiss(); });
  const btn = page.locator('.dash-action-btn', { hasText: 'js' });
  if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(1500); }
  const tabs = await shell.locator('.tab').count();
  const wins = app.windows().map((w) => w.url());
  console.log('JS-TABS', JSON.stringify({ tabs, wins }));
  expect(wins.some((u) => u.startsWith('javascript:'))).toBe(false);
  const btn2 = page.locator('.dash-action-btn', { hasText: 'file' });
  if (await btn2.count()) { await btn2.first().click(); await page.waitForTimeout(1500); }
  console.log('FILE-TABS', JSON.stringify({ tabs: await shell.locator('.tab').count(), wins: app.windows().map((w) => w.url()) }));
});

test('Riprova dopo errore: il nuovo tentativo sa del timer già avviato?', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { toolCalls: [{ id: 'e1', name: 'TIMER', arguments: JSON.stringify({ secondi: 90, etichetta: 'riso' }) }] },
    { fail: 'OpenRouter 502: upstream esploso' },
    { text: 'RIPROVA-OK' },
  ]);
  await send(page, 'timer riso 90 secondi e poi dimmi una cosa');
  const btn = page.locator('.dash-action-btn', { hasText: 'Riprova' });
  await expect(btn).toHaveCount(1, { timeout: 20_000 });
  await btn.click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RIPROVA-OK' })).toBeVisible({ timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__verCalls);
  const last = calls[calls.length - 1].messages;
  const sys = last.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const idx = sys.indexOf('PROCESSI ATTIVI');
  console.log('RETRY-STATO', JSON.stringify({ roles: last.map((m) => m.role), processi: sys.slice(idx, idx + 300), risoInSys: /riso/.test(sys), tentativo: /tentativo|fallit|già (eseguit|avviat)/i.test(JSON.stringify(last.slice(1))) }));
  const d = await dumpChat(page);
  console.log('RETRY-DOM', JSON.stringify({ bubbles: d.bubbles, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows })) }));
});

test('tema scuro dopo ricaricamento: il blocco in diretta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);
  console.log('THEME', JSON.stringify(await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, attr: document.documentElement.getAttribute('data-theme'), cls: document.documentElement.className }))));
  await installScript(app, [
    { reasoningDetails: [{ type: 'reasoning.text', text: 'Penso a cosa cercare.' }], toolCalls: [{ id: 'h1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'ricette veloci' }) }], delayMs: 1500 },
    { text: 'Trovato, ora il timer.', toolCalls: [{ id: 'h2', name: 'TIMER', arguments: JSON.stringify({ secondi: 900, etichetta: 'forno' }) }], delayMs: 1500 },
    { text: 'CRONO-FINE: ricetta trovata e timer avviato.' },
  ]);
  await send(page, 'cerca una ricetta veloce e metti un timer di 15 minuti');
  await page.waitForTimeout(700);
  try { await page.screenshot({ path: 'tests/.shots/zz-verifica-g-dark-live1.png' }); } catch (_) {}
  await page.waitForTimeout(1500);
  try { await page.screenshot({ path: 'tests/.shots/zz-verifica-g-dark-live2.png' }); } catch (_) {}
  await expect(page.locator('.dash-bubble-filo', { hasText: 'CRONO-FINE' })).toBeVisible({ timeout: 20_000 });
  await page.locator('.dash-activity-head').first().click();
  await page.waitForTimeout(400);
  try { await page.screenshot({ path: 'tests/.shots/zz-verifica-g-dark-open.png' }); } catch (_) {}
  const colors = await page.evaluate(() => {
    const cs = (el) => (el ? { color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor } : null);
    return { body: cs(document.body), head: cs(document.querySelector('.dash-activity-label')), row: cs(document.querySelector('.dash-activity-row')), note: cs(document.querySelector('.dash-activity-note')), reasoning: cs(document.querySelector('.dash-activity-reasoning')) };
  });
  console.log('DARK2', JSON.stringify(colors));
});
