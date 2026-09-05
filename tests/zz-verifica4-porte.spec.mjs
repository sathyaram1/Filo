// VERIFICA indipendente (temporaneo): le porte dei giri passati + stress.
import { test, expect } from './fixtures/electron.mjs';
import { newtabPage, setup, ask, activityRows } from './zz-verifica4-base.spec.mjs';

test('azioni silenziose: appunto + lezione lasciano riga e riassunto', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    {
      toolCalls: [
        { id: 'a1', name: 'SALVA_APPUNTO', arguments: JSON.stringify({ testo: 'comprare il latte', contesto: 'spesa' }) },
        { id: 'a2', name: 'SALVA_LEZIONE', arguments: JSON.stringify({ testo: "L'utente non beve caffè" }) },
      ],
    },
    { text: 'Fatto.' },
  ]);
  await ask(page, 'segna che devo comprare il latte e ricorda che non bevo caffè');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Fatto.', { timeout: 20_000 });
  const act = await activityRows(page);
  expect(act.rows.join(' | ')).toMatch(/Appunto salvato/);
  expect(act.rows.join(' | ')).toMatch(/Memorizzato/);
  expect(act.label).toContain('salvato un appunto');
  expect(act.label).toContain('memorizzato una cosa');
});

test('turno di sole azioni silenziose: il blocco esiste comunque', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: JSON.stringify({ testo: 'x', contesto: 'y' }) }] },
    { text: '' },
  ]);
  await ask(page, 'segna x');
  await expect(page.locator('.dash-activity')).toHaveCount(1, { timeout: 20_000 });
  const act = await activityRows(page);
  expect(act.rows.join(' | ')).toMatch(/Appunto salvato/);
});

test('azioni fallite: riga di errore e riassunto che non mente', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    {
      toolCalls: [
        { id: 'f1', name: 'TIMER', arguments: JSON.stringify({ secondi: 'due minuti', etichetta: 'uova' }) },
        { id: 'f2', name: 'SVEGLIA', arguments: JSON.stringify({ time: 'domattina presto' }) },
        { id: 'f3', name: 'LEGGI_DOCUMENTO', arguments: JSON.stringify({ percorso: '~/non-esiste-davvero-12345.pdf' }) },
        { id: 'f4', name: 'LEGGI_FILE', arguments: JSON.stringify({ fileId: 'inesistente' }) },
      ],
    },
    { text: 'Non ce l\'ho fatta.' },
  ]);
  await ask(page, 'timer di due minuti, sveglia domattina, leggi il pdf e il file');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Non ce l', { timeout: 20_000 });
  const act = await activityRows(page);
  const rows = act.rows.join(' | ');
  expect(rows).toMatch(/Timer non avviato/);
  expect(rows).toMatch(/Sveglia non impostata/);
  expect(rows).toMatch(/Documento non letto/);
  expect(rows).toMatch(/File non letto/);
  expect(act.label).not.toContain('avviato un timer');
  expect(act.label).not.toContain('letto un documento');
  expect(act.label).not.toContain('letto un file');
  // Niente timer davvero creato
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.length).toBe(0);
  // E il modello lo sa
  const calls = await app.evaluate(() => globalThis.__v.calls);
  const tool = calls[1].messages.filter((m) => m.role === 'tool').map((m) => m.content).join(' | ');
  expect(tool).toMatch(/non/i);
  expect(tool).not.toMatch(/Eseguita: Leggo/i);
});

test('byte nullo ed emoji nell\'etichetta del timer', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { toolCalls: [{ id: 't1', name: 'TIMER', arguments: JSON.stringify({ secondi: 60, etichetta: 'uo\u0000va 🍳' }) }] },
    { text: 'Timer messo.' },
  ]);
  await ask(page, 'timer uova');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Timer messo', { timeout: 20_000 });
  const act = await activityRows(page);
  expect(act.rows.join(' ')).not.toContain('\u0000');
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers[0].label).not.toContain('\u0000');
  const col = await page.locator('#timers, .dash-timers').first().textContent().catch(() => '');
  expect(String(col)).not.toContain('\u0000');
});

test('NAVIGA con javascript: non lascia bottoni ciechi', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    {
      toolCalls: [
        { id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: 'javascript:alert(1)', etichetta: 'js' }) },
        { id: 'n2', name: 'NAVIGA', arguments: JSON.stringify({ url: 'file:///C:/Windows/win.ini', etichetta: 'file' }) },
      ],
    },
    { text: 'Non posso aprirli.' },
  ]);
  await ask(page, 'apri javascript:alert(1)');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Non posso', { timeout: 20_000 });
  const act = await activityRows(page);
  expect(act.rows.join(' | ')).toMatch(/Link non aperto/);
  // nessun chip cliccabile per quei due
  const btns = await page.locator('.dash-bubble-actions a, .dash-bubble-actions button').allTextContents();
  expect(btns.join(' ')).not.toContain('js');
  expect(btns.join(' ')).not.toContain('file');
});

test('togli proxy senza scheda web: il modello sa che manca la scheda', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { toolCalls: [{ id: 'p1', name: 'RIMUOVI_PROXY', arguments: '{}' }] },
    { text: 'Devi aprire una pagina.' },
  ]);
  await ask(page, 'togli il proxy');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Devi aprire', { timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__v.calls);
  const tool = calls[1].messages.filter((m) => m.role === 'tool').map((m) => m.content).join(' ');
  expect(tool).toMatch(/scheda web/i);
  const act = await activityRows(page);
  expect(act.rows.join(' | ')).toMatch(/Proxy non tolto/);
});

test('tetto dei giri: Filo dice che si è fermato', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { text: 'giro', toolCalls: [{ id: 'x', name: 'CAPACITA_DETTAGLIO', arguments: JSON.stringify({ ids: ['save-for-later'] }) }] },
  ]);
  await ask(page, 'gira in tondo');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('fermato', { timeout: 40_000 });
});

test('ultimo giro muto: la frase scritta con l\'azione resta la risposta', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { text: 'Ti metto la sveglia alle 7, buonanotte!', toolCalls: [{ id: 's1', name: 'SVEGLIA', arguments: JSON.stringify({ time: '07:00' }) }] },
    { text: '' },
  ]);
  await ask(page, 'sveglia alle 7');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('buonanotte', { timeout: 20_000 });
  const act = await activityRows(page);
  expect(act.notes.join(' ')).not.toContain('buonanotte');
  expect(act.rows.join(' | ')).toMatch(/Sveglia impostata/);
});

test('stile della pagina, comando finestra e aspetto: righe nel diario', async ({ app, shell, openTab, testServer }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const web = await testServer.openReady(openTab, '<html><body><h1>Titolo</h1><p>testo</p></body></html>');
  const page = await newtabPage(app);
  // torna sulla home (la scheda web è quella attiva: la chat sta nella newtab)
  await setup(app, [
    {
      toolCalls: [
        { id: 'g1', name: 'IMPOSTA_ESTETICA', arguments: JSON.stringify({ token: 'accent', valore: '#3366cc' }) },
        { id: 'g2', name: 'COMANDO_FINESTRA', arguments: JSON.stringify({ comando: 'settings' }) },
      ],
    },
    { text: 'Fatto tutto.' },
  ]);
  await page.bringToFront();
  await expect(page.locator('#input')).toBeVisible();
  await ask(page, 'metti l\'accento blu e apri le impostazioni');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Fatto tutto', { timeout: 20_000 });
  const act = await activityRows(page);
  expect(act.rows.join(' | ')).toMatch(/Aspetto ·/);
  expect(act.rows.join(' | ')).toMatch(/Impostazioni aperte|Comando della finestra/);
  expect(act.label).toContain("cambiato l'aspetto");
  expect(act.label).toContain('azionato un comando della finestra');
  await web.close().catch(() => {});
});
