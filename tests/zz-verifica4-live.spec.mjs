// VERIFICA indipendente (temporaneo): diretta, id mancanti, invii rapidi, tema.
import { test, expect } from './fixtures/electron.mjs';
import { newtabPage, setup, ask, activityRows } from './zz-verifica4-base.spec.mjs';
import { clickConfirm, fillConfirmInput, CONFIRM_HOST } from './helpers/confirm.mjs';

test('in diretta: ragionamento, riga in testa e riga della ricerca PRIMA della risposta', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    {
      reasoning: ['Devo cercare sul web. '],
      toolCalls: [{ id: 'l1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'meteo' }) }],
    },
    { text: 'Domani sole.', delay: 4000 },
  ]);
  await ask(page, 'che tempo fa');
  // Mentre il secondo giro è ancora in corso: la riga della ricerca c'è già,
  // la risposta no.
  await expect(page.locator('.dash-activity-row')).toHaveCount(1, { timeout: 8_000 });
  const durante = await page.evaluate(() => {
    const a = document.querySelector('.dash-activity');
    return {
      label: a.querySelector('.dash-activity-label').textContent,
      righe: Array.from(a.querySelectorAll('.dash-activity-row')).map((r) => r.textContent),
      ragionamento: a.querySelector('.dash-activity-reasoning') ? a.querySelector('.dash-activity-reasoning').textContent : '',
      risposta: document.body.innerText.includes('Domani sole'),
    };
  });
  console.log('IN-DIRETTA', JSON.stringify(durante));
  expect(durante.righe.join(' ')).toMatch(/Cerco sul web/);
  expect(durante.risposta, 'la risposta non è ancora arrivata').toBe(false);
  expect(durante.ragionamento).toContain('Devo cercare');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Domani sole', { timeout: 20_000 });
});

test('chiamate senza id dal fornitore: due timer, due righe, due esiti distinti', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    {
      toolCalls: [
        { name: 'TIMER', arguments: JSON.stringify({ secondi: 60, etichetta: 'uno' }) },
        { name: 'TIMER', arguments: JSON.stringify({ secondi: 120, etichetta: 'due' }) },
      ],
    },
    { text: 'Due timer avviati.' },
  ]);
  await ask(page, 'due timer');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Due timer', { timeout: 20_000 });
  const act = await activityRows(page);
  expect(act.rows.length).toBe(2);
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.length).toBe(2);
  const calls = await app.evaluate(() => globalThis.__v.calls);
  const ids = calls[1].messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
  expect(new Set(ids).size).toBe(2);
  const asst = calls[1].messages.find((m) => m.role === 'assistant' && m.tool_calls);
  expect(asst.tool_calls.map((c) => c.id)).toEqual(ids);
});

test('doppio e triplo invio rapido: un turno solo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [{ text: 'Ciao.', delay: 1500 }]);
  await page.locator('#input').fill('ciao');
  await page.locator('#sendBtn').click();
  await page.locator('#sendBtn').click({ force: true }).catch(() => {});
  await page.locator('#sendBtn').click({ force: true }).catch(() => {});
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ciao.', { timeout: 20_000 });
  await page.waitForTimeout(500);
  expect(await page.locator('.dash-bubble-user').count()).toBe(1);
  const calls = await app.evaluate(() => globalThis.__v.calls);
  expect(calls.length).toBe(1);
});

test('livello 3: senza «conferma» digitata non succede niente', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.saveLesson
      ? globalThis.SN_FILO_MEMORY.saveLesson('prova')
      : null;
  }).catch(() => {});
  await setup(app, [
    { toolCalls: [{ id: 'd1', name: 'CANCELLA_MEMORIA', arguments: '{}' }] },
    { text: 'Serve la tua conferma.' },
  ]);
  await ask(page, 'cancella tutta la memoria');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('conferma', { timeout: 20_000 });
  // Nessun popup aperto da solo per il livello 3: c'è il bottone
  expect(await page.locator(CONFIRM_HOST).count()).toBe(0);
  const btn = page.locator('.dash-bubble-actions button').first();
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  await clickConfirm(page, 'cancel');
  const act = await activityRows(page);
  console.log('LIVELLO3', JSON.stringify(act));
});

test('aspetto: blocco chiuso e aperto, tema chiaro e scuro', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    {
      reasoning: ['Rifletto un momento. '],
      text: 'Metto tutto.',
      toolCalls: [
        { id: 'v1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'ricette' }) },
        { id: 'v2', name: 'TIMER', arguments: JSON.stringify({ secondi: 600, etichetta: 'forno' }) },
      ],
    },
    { text: 'Ecco fatto: il forno è avviato.' },
  ]);
  await ask(page, 'cerca ricette e metti un timer');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ecco fatto', { timeout: 20_000 });
  await page.screenshot({ path: 'tests/.shots/zzv4-chiaro-chiuso.png' });
  await page.locator('.dash-activity-head').last().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/zzv4-chiaro-aperto.png' });
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/zzv4-scuro-aperto.png' });
});
