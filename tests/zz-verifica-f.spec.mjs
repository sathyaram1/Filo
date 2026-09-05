// Verifica avversariale (temporaneo): diagnosi mirate sui dubbi emersi.
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

async function clickDiag(page, sel) {
  return page.evaluate((sel) => {
    const el = Array.from(document.querySelectorAll(sel)).find((b) => /riprova|vuole impostare|conferm/i.test(b.textContent));
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return { found: true, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, vw: innerWidth, vh: innerHeight, top: top ? top.tagName + '.' + top.className : null, disabled: el.disabled, display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility, pe: getComputedStyle(el).pointerEvents, text: el.textContent };
  }, sel);
}

test('Riprova dopo un errore a metà: perché il click non passa?', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { toolCalls: [{ id: 'e1', name: 'TIMER', arguments: JSON.stringify({ secondi: 90, etichetta: 'riso' }) }] },
    { fail: 'OpenRouter 502: upstream esploso' },
    { text: 'RIPROVA-OK' },
  ]);
  await send(page, 'timer riso 90 secondi e poi dimmi una cosa');
  await expect(page.locator('.dash-action-btn', { hasText: 'Riprova' })).toHaveCount(1, { timeout: 20_000 });
  await page.waitForTimeout(500);
  console.log('RIPROVA-DIAG', JSON.stringify(await clickDiag(page, '.dash-action-btn')));
  try { await page.screenshot({ path: 'tests/.shots/zz-verifica-f-riprova.png' }); } catch (_) {}
  const btn = page.locator('.dash-action-btn', { hasText: 'Riprova' });
  let clicked = 'locator';
  try { await btn.click({ timeout: 5000 }); } catch (e) { clicked = 'fallback:' + String(e).slice(0, 80); await btn.evaluate((b) => b.click()); }
  console.log('CLICK-VIA', clicked);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RIPROVA-OK' })).toBeVisible({ timeout: 20_000 });
  const timers = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listTimers());
  const d = await dumpChat(page);
  const calls = await app.evaluate(() => globalThis.__verCalls);
  console.log('DOPO-RIPROVA', JSON.stringify({ timers: timers.map((t) => t.label), idx: calls.length, bubbles: d.bubbles, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows })), users: await page.locator('.dash-bubble-user').count(), lastMsgs: calls[calls.length - 1].messages.slice(-4).map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 120), tc: m.tool_calls && m.tool_calls.length })) }));
  expect(timers.filter((t) => /riso/.test(t.label || '')).length).toBe(1);
});

test('conferma di livello 2: il click sul bottone', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { text: 'Attivo il terminale.', toolCalls: [{ id: 'k1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modalita_terminale', valore: true }) }] },
    { text: 'CONF-FINE: dimmi tu.' },
  ]);
  await send(page, 'attiva il terminale');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'CONF-FINE' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  console.log('CONF-DIAG', JSON.stringify(await clickDiag(page, '.dash-action-btn')));
  console.log('CONF-HTML', await page.evaluate(() => (document.getElementById('bubbles') || {}).innerHTML?.slice(-1800)));
  try { await page.screenshot({ path: 'tests/.shots/zz-verifica-f-conferma.png' }); } catch (_) {}
  const btn = page.locator('.dash-action-btn', { hasText: 'vuole impostare' });
  let clicked = 'locator';
  try { await btn.click({ timeout: 5000 }); } catch (e) { clicked = 'fallback:' + String(e).slice(0, 80); await btn.evaluate((b) => b.click()); }
  console.log('CLICK-VIA', clicked);
  await page.waitForTimeout(1500);
  console.log('CONF-HTML2', await page.evaluate(() => (document.getElementById('bubbles') || {}).innerHTML?.slice(-1800)));
  console.log('CONF-OVERLAY', await page.evaluate(() => Array.from(document.querySelectorAll('[class*=popup],[class*=modal],[class*=overlay],[class*=confirm],dialog')).map((e) => e.className + ':' + (e.textContent || '').slice(0, 150).replace(/\s+/g, ' '))));
  try { await page.screenshot({ path: 'tests/.shots/zz-verifica-f-conferma2.png' }); } catch (_) {}
  // Se c'è un popup con un bottone di conferma, premilo.
  const ok = page.locator('button', { hasText: /^(conferma|sì|ok|attiva)/i });
  if (await ok.count()) { await ok.first().click(); await page.waitForTimeout(1000); }
  const after = await app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
  const d = await dumpChat(page);
  console.log('CONF-DOPO', JSON.stringify({ terminal: after.terminal, bubbles: d.bubbles, actions: d.actions, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })) }));
  expect(!!(after.terminal && after.terminal.enabled)).toBe(true);
});

test('doppio invio rapido: la linea del tempo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { toolCalls: [{ id: 'l1', name: 'TIMER', arguments: JSON.stringify({ secondi: 60, etichetta: 'lungo' }) }], delayMs: 1500 },
    { text: 'LUNGO-FINE', delayMs: 300 },
  ]);
  await app.evaluate(() => { globalThis.__verT0 = Date.now(); });
  await page.locator('#input').fill('un messaggio');
  const states = [];
  const snap = async (tag) => states.push({ tag, t: Date.now(), btn: await page.evaluate(() => { const b = document.getElementById('sendBtn'); return b ? { text: b.textContent.trim(), title: b.title, cls: b.className, disabled: b.disabled } : null; }), input: await page.locator('#input').inputValue(), users: await page.locator('.dash-bubble-user').count() });
  await snap('prima');
  await page.locator('#sendBtn').click();
  await snap('dopo-1');
  await page.locator('#sendBtn').click();
  await snap('dopo-2');
  await page.locator('#sendBtn').click();
  await snap('dopo-3');
  await page.waitForTimeout(4000);
  await snap('fine');
  const calls = await app.evaluate(() => globalThis.__verCalls.map((c) => ({ i: c.i, lastUser: c.messages.filter((m) => m.role === 'user').pop()?.content?.slice(0, 40), n: c.messages.length })));
  const d = await dumpChat(page);
  const timers = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listTimers());
  console.log('DOPPIO-TL', JSON.stringify({ states, calls, bubbles: d.bubbles, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows })), timers: timers.map((t) => t.label) }, null, 1));
});

test('azioni silenziose nel diario: appunto, lezione, spunta, proxy', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { toolCalls: [
      { id: 'a2', name: 'SALVA_APPUNTO', arguments: JSON.stringify({ testo: 'comprare il latte', contesto: 'spesa' }) },
      { id: 'a3', name: 'SALVA_LEZIONE', arguments: JSON.stringify({ testo: 'L’utente non beve caffè' }) },
      { id: 'a4', name: 'ONBOARDING', arguments: JSON.stringify({ spunta: ['profilo'] }) },
      { id: 'a8', name: 'RIMUOVI_PROXY_TUTTE', arguments: '{}' },
      { id: 'a9', name: 'TIMER', arguments: JSON.stringify({ secondi: 60, etichetta: 'segnaposto' }) },
    ] },
    { text: 'SILENZIOSE-FINE' },
  ]);
  await send(page, 'salva un appunto e una lezione');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'SILENZIOSE-FINE' })).toBeVisible({ timeout: 20_000 });
  const d = await dumpChat(page);
  console.log('SILENZIOSE', JSON.stringify({ bubbles: d.bubbles, actions: d.actions, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })), html: await page.evaluate(() => (document.getElementById('bubbles') || {}).innerHTML?.slice(-2500)) }));
  const keys = await app.evaluate(async () => Object.keys(await new Promise((r) => chrome.storage.local.get(null, r))));
  console.log('KEYS', JSON.stringify(keys));
});

test('stress: il resto degli esiti', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { toolCalls: [
      { id: 'x2', name: 'CERCA_WEB', arguments: 'questo non è json' },
      { id: 'x3', name: 'SVEGLIA', arguments: '[1,2,3]' },
      { id: 'x4', name: 'CERCA_WEB', arguments: JSON.stringify({ query: '<script>window.__xss=1</script><img src=x onerror="window.__xss=2">' }) },
      { id: 'x5', name: 'TIMER', arguments: JSON.stringify({ secondi: 30, etichetta: '🍝 pasta   x' }) },
      { id: 'x6', name: 'TIMER', arguments: JSON.stringify({ secondi: 'trenta', etichetta: 'rotto' }) },
      { id: 'x7', name: 'SVEGLIA', arguments: JSON.stringify({ time: 'boh', label: 'orario rotto' }) },
      { id: 'x8', name: 'NAVIGA', arguments: JSON.stringify({ url: 'javascript:alert(1)', etichetta: 'js' }) },
    ] },
    { text: 'STRESS-FINE' },
  ]);
  await send(page, 'stress');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'STRESS-FINE' })).toBeVisible({ timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__verCalls);
  const res = {};
  for (const m of toolMsgs(calls[1])) res[m.tool_call_id] = m.content;
  console.log('STRESS-ESITI', JSON.stringify(res, null, 1));
  const xss = await page.evaluate(() => ({ v: window.__xss, scripts: document.querySelectorAll('.dash-activity script, .dash-activity img').length, rows: Array.from(document.querySelectorAll('.dash-activity-row')).map((r) => r.textContent) }));
  console.log('XSS', JSON.stringify(xss));
  const timers = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listTimers());
  console.log('TIMERS', JSON.stringify(timers.map((t) => t.label)));
  const d = await dumpChat(page);
  console.log('STRESS-DOM', JSON.stringify({ actions: d.actions, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows })) }));
  console.log('TABS', await shell.locator('.tab').count());
  expect(xss.v).toBeUndefined();
  expect(xss.scripts).toBe(0);
});
