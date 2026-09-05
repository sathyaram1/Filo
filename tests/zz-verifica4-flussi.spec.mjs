// VERIFICA indipendente (temporaneo): conferme, guasti, stress.
import { test, expect } from './fixtures/electron.mjs';
import { newtabPage, setup, ask, activityRows } from './zz-verifica4-base.spec.mjs';
import { clickConfirm, CONFIRM_HOST } from './helpers/confirm.mjs';

test('conferma livello 2: riga nel diario, riassunto e contesto del turno dopo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    {
      text: 'Attivo il terminale.',
      toolCalls: [{ id: 'k1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modalita_terminale', valore: true }) }],
    },
    { text: 'Ci penso io.' },
    { text: 'Sì, è attivo.' },
  ]);
  await ask(page, 'attiva la modalità terminale');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 20_000 });
  await clickConfirm(page, 'ok');
  await page.waitForTimeout(600);

  const act = await activityRows(page);
  console.log('CONFERMA-DIARIO', JSON.stringify(act));
  expect(act.rows.join(' | '), 'riga dell\'impostazione confermata').toMatch(/Impostato · modalita_terminale/);
  expect(act.label, 'riassunto del blocco dopo la conferma').toContain("cambiato un'impostazione");

  // Turno dopo: il modello sa della conferma
  await ask(page, 'il terminale è attivo?');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('è attivo', { timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__v.calls);
  const blob = JSON.stringify(calls[calls.length - 1].messages);
  expect(blob, 'la conferma nel contesto del turno dopo').toMatch(/CONFERMATO/);
});

test('guasto a metà turno: il timer resta, il blocco lo dice, Riprova non lo rifà', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { toolCalls: [{ id: 'z1', name: 'TIMER', arguments: JSON.stringify({ secondi: 300, etichetta: 'forno' }) }] },
    { throw: 'rete assente' },
    { text: 'Il timer del forno è già in corso.' },
  ]);
  await ask(page, 'timer forno 5 minuti');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText(/[Rr]iprova|storto|Errore/, { timeout: 20_000 });
  const act = await activityRows(page);
  expect(act.label).toContain('Tentativo non riuscito');
  expect(act.rows.join(' | ')).toMatch(/Timer avviato/);
  let timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.length).toBe(1);

  await page.locator('.dash-bubble-actions button', { hasText: 'Riprova' }).first().click();
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('già in corso', { timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__v.calls);
  const blob = JSON.stringify(calls[calls.length - 1].messages);
  expect(blob, 'il nuovo tentativo sa del timer già messo').toMatch(/GIÀ STATE FATTE|Timer/);
  timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.length).toBe(1);
});

test('strumento sconosciuto e argomenti rotti: il turno finisce lo stesso', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    {
      toolCalls: [
        { id: 'u1', name: 'FAI_IL_CAFFE', arguments: '{}' },
        { id: 'u2', name: 'TIMER', arguments: 'non json' },
        { id: 'u3', name: 'TIMER', arguments: '[1,2,3]' },
      ],
    },
    { text: 'Non ci sono riuscito.' },
  ]);
  await ask(page, 'fai il caffè');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Non ci sono riuscito', { timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__v.calls);
  const tools = calls[1].messages.filter((m) => m.role === 'tool');
  expect(tools.length).toBe(3);
  expect(tools.map((t) => t.content).join(' | ')).toMatch(/NON eseguita/);
});

test('HTML nella query e messaggio da 10.000 caratteri', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { toolCalls: [{ id: 'h1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: '<img src=x onerror=alert(1)>' }) }] },
    { text: 'Ecco.' },
  ]);
  const lungo = 'a'.repeat(10000);
  await ask(page, lungo);
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ecco.', { timeout: 25_000 });
  const act = await activityRows(page);
  expect(act.rows.join(' ')).toContain('<img src=x onerror=alert(1)>');
  const imgs = await page.locator('.dash-activity img').count();
  expect(imgs).toBe(0);
  const calls = await app.evaluate(() => globalThis.__v.calls);
  const userMsg = calls[0].messages.filter((m) => m.role === 'user').pop();
  expect(String(userMsg.content).length).toBeGreaterThan(9000);
});

test('formato vecchio (JSON nel testo) ancora tollerato', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { text: JSON.stringify({ text: 'Timer messo.', actions: [{ type: 'TIMER', secondi: 90, etichetta: 'tè' }] }) },
  ]);
  await ask(page, 'timer tè');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Timer messo.', { timeout: 20_000 });
  const bubble = await page.locator('.dash-bubble-filo').last().textContent();
  expect(bubble).not.toContain('"actions"');
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.length).toBe(1);
});

test('comando col terminale spento: spiegazione, niente loop', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: 'dir' }) }] },
    { text: 'Devi attivare la modalità terminale.' },
  ]);
  await ask(page, 'elenca i file');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('modalità terminale', { timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__v.calls);
  expect(calls.length).toBe(2);
  expect(await page.locator('.dash-cmd-blocked').count()).toBeGreaterThan(0);
});

test('il blocco di attività dopo un ricaricamento della home', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { toolCalls: [{ id: 'r1', name: 'TIMER', arguments: JSON.stringify({ secondi: 120, etichetta: 'uova' }) }] },
    { text: 'Timer avviato.' },
  ]);
  await ask(page, 'timer uova 2 minuti');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Timer avviato.', { timeout: 20_000 });
  await page.reload();
  await page.waitForTimeout(1500);
  const dopo = await page.evaluate(() => ({
    bolle: document.querySelectorAll('.dash-bubble').length,
    blocchi: document.querySelectorAll('.dash-activity').length,
  }));
  console.log('DOPO-RELOAD', JSON.stringify(dopo));
  expect(dopo.bolle === 0 || dopo.blocchi > 0, 'o si perde tutto o si tiene tutto').toBe(true);
});
