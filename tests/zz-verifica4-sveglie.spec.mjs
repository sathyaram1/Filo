// VERIFICA indipendente (temporaneo): sveglie tolte/spostate, proxy e stile pagina.
import { test, expect } from './fixtures/electron.mjs';
import { newtabPage, setup, ask, activityRows } from './zz-verifica4-base.spec.mjs';

test('sveglia cancellata e spostata: riga nel diario, voce nel riassunto, esito al modello', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'palestra', time: '07:00', kind: 'alarm' });
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'lezione', time: '08:30', kind: 'alarm' });
  });
  await setup(app, [
    {
      toolCalls: [
        { id: 'm1', name: 'MODIFICA_SVEGLIA', arguments: JSON.stringify({ etichetta: 'lezione', orario: '09:15' }) },
        { id: 'm2', name: 'CANCELLA_SVEGLIA', arguments: JSON.stringify({ etichetta: 'palestra' }) },
      ],
    },
    { text: 'Fatto.' },
  ]);
  await ask(page, 'sposta la lezione alle 9:15 e togli la palestra');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Fatto.', { timeout: 20_000 });
  const act = await activityRows(page);
  console.log('SVEGLIE', JSON.stringify(act));
  expect(act.rows.join(' | ')).toMatch(/Spostata/);
  expect(act.rows.join(' | ')).toMatch(/Cancellata/);
  expect(act.label).toContain('spostato una sveglia');
  expect(act.label).toContain('cancellato una sveglia');
  const calls = await app.evaluate(() => globalThis.__v.calls);
  const tool = calls[1].messages.filter((m) => m.role === 'tool').map((m) => m.content);
  console.log('SVEGLIE-ESITI', JSON.stringify(tool));
  expect(tool.join(' ')).toMatch(/Spostate|Tolte/);
  const rimasti = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(rimasti.length).toBe(1);
});

test('scheda web aperta: stile pagina, ripristino e proxy tolto', async ({ app, shell, openTab, testServer }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    {
      toolCalls: [
        { id: 's1', name: 'STILE_PAGINA', arguments: JSON.stringify({ regole: [{ selettore: 'h1', css: 'color:#ff0000' }], descrizione: 'titoli rossi' }) },
      ],
    },
    { text: 'Titoli in rosso.' },
    {
      toolCalls: [
        { id: 's2', name: 'RIPRISTINA_STILE_PAGINA', arguments: '{}' },
        { id: 's3', name: 'RIMUOVI_PROXY_TUTTE', arguments: '{}' },
      ],
    },
    { text: 'Rimesso com\'era.' },
  ]);
  const web = await testServer.openReady(openTab, '<html><body><h1>Titolo</h1></body></html>');
  await ask(page, 'metti i titoli in rosso');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Titoli in rosso', { timeout: 20_000 });
  const colore = await web.locator('h1').evaluate((el) => getComputedStyle(el).color);
  console.log('COLORE-H1', colore);
  const act1 = await activityRows(page);
  console.log('STILE', JSON.stringify(act1));

  await ask(page, 'rimetti com\'era e togli i proxy');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText("Rimesso com'era", { timeout: 20_000 });
  const act2 = await activityRows(page);
  console.log('RIPRISTINO', JSON.stringify(act2));
  const colore2 = await web.locator('h1').evaluate((el) => getComputedStyle(el).color);
  console.log('COLORE-H1-DOPO', colore2);
  expect(act1.rows.join(' | ')).toMatch(/Aspetto della pagina/);
  expect(act2.rows.join(' | ')).toMatch(/ripristinato/);
  expect(act2.rows.join(' | ')).toMatch(/schede riportate in Italia/);
  expect(colore).toBe('rgb(255, 0, 0)');
  expect(colore2).not.toBe('rgb(255, 0, 0)');
});

test('appunto: riga nel diario e bottone per aprirlo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { toolCalls: [{ id: 'n1', name: 'SALVA_APPUNTO', arguments: JSON.stringify({ testo: 'latte, uova', contesto: 'spesa' }) }] },
    { text: 'Segnato.' },
  ]);
  await ask(page, 'segna latte e uova');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Segnato.', { timeout: 20_000 });
  const btns = await page.locator('.dash-bubble-actions button, .dash-bubble-actions a').allTextContents();
  console.log('APPUNTO-BOTTONI', JSON.stringify(btns));
  expect(btns.length, 'un modo per aprire l\'appunto').toBeGreaterThan(0);
});
