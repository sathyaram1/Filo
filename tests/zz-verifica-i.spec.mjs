// Verifica avversariale (temporaneo): livello 3 a metà giro, riga per «stile pagina», azione fallita visibile.
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

test('cancella memoria (digita «conferma») a metà giro', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await installScript(app, [
    { toolCalls: [{ id: 'm1', name: 'CANCELLA_MEMORIA', arguments: '{}' }, { id: 'm2', name: 'TIMER', arguments: JSON.stringify({ secondi: 60, etichetta: 'dopo' }) }] },
    { text: 'MEM-FINE' },
  ]);
  await send(page, 'cancella tutta la memoria e metti un timer');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'MEM-FINE' })).toBeVisible({ timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__verCalls);
  const d = await dumpChat(page);
  console.log('MEM', JSON.stringify({ res: toolMsgs(calls[1]).map((m) => m.content.slice(0, 200)), bubbles: d.bubbles, actions: d.actions, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })), html: await page.evaluate(() => (document.getElementById('bubbles') || {}).innerHTML?.slice(-1200)) }));
  const timers = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.length).toBe(1);
});

test('stile pagina: riga nel diario; azione fallita: cosa vede l’utente', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await setup(app, shell);
  await testServer.openReady(openTab, '<h1 id="t">Titolo</h1>');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 8_000 });
  await installScript(app, [
    { toolCalls: [
      { id: 's1', name: 'STILE_PAGINA', arguments: JSON.stringify({ regole: [{ selettore: 'h1', css: 'color: rgb(255, 0, 0)' }], descrizione: 'titoli rossi' }) },
      { id: 's2', name: 'PROXY_TAB', arguments: JSON.stringify({ country: 'zz' }) },
      { id: 's3', name: 'TIMER', arguments: JSON.stringify({ secondi: 'trenta', etichetta: 'rotto' }) },
      { id: 's4', name: 'SVEGLIA', arguments: JSON.stringify({ time: 'boh', label: 'rotta' }) },
    ] },
    { text: 'FALLITE-FINE' },
  ]);
  await send(page, 'titoli rossi, proxy, timer e sveglia');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'FALLITE-FINE' })).toBeVisible({ timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__verCalls);
  const d = await dumpChat(page);
  console.log('FALLITE', JSON.stringify({ res: toolMsgs(calls[1]).map((m) => m.content.slice(0, 160)), bubbles: d.bubbles, actions: d.actions, acts: d.activities.map((a) => ({ head: a.head, rows: a.rows, notes: a.notes })) }));
});
