// Verifica avversariale (temporaneo): il blocco di attività sopravvive? e «vai alla home».
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

test('il blocco di attività dopo un ricaricamento della home', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { text: 'Un attimo…', toolCalls: [{ id: 'r1', name: 'TIMER', arguments: JSON.stringify({ secondi: 120, etichetta: 'uova' }) }] },
    { text: 'RELOAD-FINE' },
  ]);
  await send(page, 'timer uova 2 minuti');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RELOAD-FINE' })).toBeVisible({ timeout: 20_000 });
  const before = await dumpChat(page);
  console.log('PRIMA', JSON.stringify({ bubbles: before.bubbles, acts: before.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })) }));
  expect(before.activities.length).toBe(1);
  await page.reload();
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  const after = await dumpChat(page);
  console.log('DOPO-RELOAD', JSON.stringify({ bubbles: after.bubbles, acts: after.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })), users: await page.locator('.dash-bubble-user').count() }));
  // La conversazione è ancora lì?
  const users = await page.locator('.dash-bubble-user').count();
  console.log('CONV-RESTA', users, after.bubbles.length);
  if (users > 0) expect(after.activities.length, 'il blocco di attività sparisce al ricaricamento mentre le bolle restano').toBe(1);
});

test('«vai alla home» dalla chat della home: cosa succede alla conversazione', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await page.evaluate(() => { window.__marker = 'vivo'; });
  await installScript(app, [
    { toolCalls: [
      { id: 'h1', name: 'TIMER', arguments: JSON.stringify({ secondi: 120, etichetta: 'uova' }) },
      { id: 'h2', name: 'COMANDO_FINESTRA', arguments: JSON.stringify({ comando: 'home' }) },
    ] },
    { text: 'HOME-FINE' },
  ]);
  await send(page, 'timer uova e vai alla home');
  await page.waitForTimeout(4000);
  const tabs = await shell.locator('.tab').count();
  const wins = app.windows().map((w) => w.url());
  const pages = app.windows().filter((w) => w.url().startsWith('filo://newtab'));
  const dumps = [];
  for (const p of pages) {
    try {
      dumps.push({ url: p.url(), marker: await p.evaluate(() => window.__marker), users: await p.locator('.dash-bubble-user').count(), ...(await dumpChat(p)) });
    } catch (e) { dumps.push({ url: p.url(), err: String(e).slice(0, 100) }); }
  }
  console.log('HOME', JSON.stringify({ tabs, wins, dumps: dumps.map((d) => ({ url: d.url, marker: d.marker, users: d.users, bubbles: d.bubbles, acts: (d.activities || []).map((a) => ({ head: a.head, rows: a.rows })) })) }));
  const calls = await app.evaluate(() => globalThis.__verCalls);
  console.log('HOME-ESITI', JSON.stringify(calls.length > 1 ? toolMsgs(calls[1]).map((m) => m.content) : null));
});

test('stesso turno delle porte, senza «vai alla home»: il blocco c’è con spostata e cancellata', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { toolCalls: [
      { id: 'a1', name: 'SVEGLIA', arguments: JSON.stringify({ time: '07:00', label: 'palestra' }) },
      { id: 'a2', name: 'SALVA_APPUNTO', arguments: JSON.stringify({ testo: 'comprare il latte', contesto: 'spesa' }) },
      { id: 'a3', name: 'SALVA_LEZIONE', arguments: JSON.stringify({ testo: 'L’utente non beve caffè' }) },
      { id: 'a4', name: 'ONBOARDING', arguments: JSON.stringify({ spunta: ['profilo'] }) },
      { id: 'a5', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'tema', valore: 'scuro' }) },
      { id: 'a8', name: 'RIMUOVI_PROXY_TUTTE', arguments: '{}' },
    ] },
    { toolCalls: [{ id: 'b1', name: 'MODIFICA_SVEGLIA', arguments: JSON.stringify({ etichetta: 'palestra', orario: '08:00' }) }] },
    { toolCalls: [{ id: 'c1', name: 'CANCELLA_SVEGLIA', arguments: JSON.stringify({ etichetta: 'palestra' }) }] },
    { text: 'PORTE2-FINE' },
  ]);
  await send(page, 'fai tutte queste cose');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'PORTE2-FINE' })).toBeVisible({ timeout: 30_000 });
  const d = await dumpChat(page);
  console.log('PORTE2-DOM', JSON.stringify({ bubbles: d.bubbles, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })) }));
  const rows = d.activities.flatMap((a) => a.rows).join(' | ');
  expect(rows).toMatch(/spostat|modificat/i);
  expect(rows).toMatch(/cancellat|tolt|rimoss/i);
  expect(d.activities[0].head).toMatch(/spostat|modificat/i);
  expect(d.activities[0].head).toMatch(/cancellat|tolt|rimoss/i);
  // L'appunto esiste davvero nell'editor?
  const files = await app.evaluate(async () => {
    const st = await globalThis.SN_STORAGE.get ? null : null;
    const all = await new Promise((r) => chrome.storage.local.get(null, r));
    return Object.keys(all).filter((k) => /editor|file|appunt|note/i.test(k)).map((k) => [k, JSON.stringify(all[k]).slice(0, 300)]);
  });
  console.log('FILES', JSON.stringify(files));
});

test('togli proxy con una scheda web aperta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await testServer.openReady(openTab, '<h1>pagina</h1>');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 8_000 });
  await installScript(app, [
    { toolCalls: [
      { id: 'p1', name: 'RIMUOVI_PROXY', arguments: '{}' },
      { id: 'p2', name: 'RIMUOVI_PROXY_TUTTE', arguments: '{}' },
    ] },
    { text: 'PROXY-FINE' },
  ]);
  await send(page, 'togli il proxy');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'PROXY-FINE' })).toBeVisible({ timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__verCalls);
  const res = toolMsgs(calls[1]).map((m) => m.content);
  const d = await dumpChat(page);
  console.log('PROXY', JSON.stringify({ res, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows })) }));
  for (const r of res) expect(r).not.toMatch(/non riuscita|NON eseguita/i);
});
