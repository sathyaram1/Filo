// Verifica avversariale (temporaneo): cronologia AI per giro e tema scuro.
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

const SCRIPT = [
  { reasoningDetails: [{ type: 'reasoning.text', text: 'Penso a cosa cercare.' }],
    toolCalls: [{ id: 'h1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'ricette veloci' }) }], delayMs: 400 },
  { text: 'Trovato, ora il timer.', toolCalls: [{ id: 'h2', name: 'TIMER', arguments: JSON.stringify({ secondi: 900, etichetta: 'forno' }) }], delayMs: 400 },
  { text: 'CRONO-FINE: ricetta trovata e timer avviato.' },
];

test('cronologia AI: una voce per giro, misure e azioni, visibili nella pagina', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const page = await setup(app, shell);
  await installScript(app, SCRIPT);
  await send(page, 'cerca una ricetta veloce e metti un timer di 15 minuti');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'CRONO-FINE' })).toBeVisible({ timeout: 20_000 });
  const hist = await app.evaluate(async () => globalThis.SN_HISTORY.list());
  const chat = hist.filter((h) => h.action === 'filo_chat');
  console.log('HIST', JSON.stringify(chat.map((h) => ({ timing: h.timing, output: (h.output || '').slice(0, 120), servedBy: h.servedBy, usage: h.usage, cost: h.costEur })), null, 1));
  expect(chat.length).toBe(3);
  for (const h of chat) expect(Number(h.timing && h.timing.totalMs)).toBeGreaterThan(0);
  // Il giro col ragionamento ha la misura del ragionamento; quello col testo ha la misura del testo.
  expect(chat.some((h) => h.timing.firstReasoningMs != null)).toBe(true);
  expect(chat.some((h) => h.timing.firstTextMs != null)).toBe(true);
  expect(chat.some((h) => /CERCA_WEB/.test(h.output || ''))).toBe(true);
  expect(chat.some((h) => /TIMER/.test(h.output || ''))).toBe(true);

  const hp = await openTab('filo://history/history.html');
  await expect(hp.locator('.sn-history-item').first()).toBeVisible({ timeout: 10_000 });
  const items = await hp.evaluate(() => Array.from(document.querySelectorAll('.sn-history-item')).map((it) => ({
    meta: it.querySelector('.sn-history-meta')?.textContent.replace(/\s+/g, ' ').trim(),
    timing: it.querySelector('.sn-history-timing')?.textContent,
    title: it.querySelector('.sn-history-timing')?.title,
    out: it.querySelector('.sn-history-output')?.textContent.slice(0, 100),
  })));
  console.log('PAGE', JSON.stringify(items, null, 1));
  expect(items.filter((i) => i.timing).length).toBeGreaterThanOrEqual(3);
  try { await hp.screenshot({ path: 'tests/.shots/zz-verifica-d-history.png' }); } catch (_) {}
});

test('tema scuro: il blocco di attività si legge', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await setup(app, shell);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await page.waitForTimeout(800);
  await installScript(app, SCRIPT);
  await send(page, 'cerca una ricetta veloce e metti un timer di 15 minuti');
  await page.waitForTimeout(600);
  try { await page.screenshot({ path: 'tests/.shots/zz-verifica-d-dark-live.png' }); } catch (_) {}
  await expect(page.locator('.dash-bubble-filo', { hasText: 'CRONO-FINE' })).toBeVisible({ timeout: 20_000 });
  // Apri il blocco (se è richiudibile) per vedere le righe.
  await page.evaluate(() => { document.querySelectorAll('.dash-activity').forEach((a) => { if ('open' in a) a.open = true; }); });
  await page.waitForTimeout(300);
  const colors = await page.evaluate(() => {
    const a = document.querySelector('.dash-activity');
    const head = a && a.querySelector('.dash-activity-head');
    const row = a && a.querySelector('.dash-activity-row');
    const note = a && a.querySelector('.dash-activity-note');
    const cs = (el) => (el ? { color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor } : null);
    return { body: cs(document.body), block: cs(a), head: cs(head), row: cs(row), note: cs(note), theme: document.documentElement.getAttribute('data-theme') || document.documentElement.className };
  });
  console.log('DARK', JSON.stringify(colors));
  try { await page.screenshot({ path: 'tests/.shots/zz-verifica-d-dark.png' }); } catch (_) {}
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'light' }); });
  await page.waitForTimeout(800);
  try { await page.screenshot({ path: 'tests/.shots/zz-verifica-d-light.png' }); } catch (_) {}
});
