// VERIFICA indipendente (temporaneo): accoglienza, cronologia AI, dettagli.
import { test, expect } from './fixtures/electron.mjs';
import { newtabPage, setup, ask, activityRows } from './zz-verifica4-base.spec.mjs';

test('terminale spento: cosa vede davvero l\'utente in chat', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: 'dir' }) }] },
    { text: 'Ok.' },
  ]);
  await ask(page, 'elenca i file');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ok.', { timeout: 20_000 });
  const vista = await page.evaluate(() => {
    const b = document.querySelectorAll('.dash-activity');
    const last = b[b.length - 1];
    return {
      aperto: last ? !last.querySelector('.dash-activity-body').hidden : null,
      label: last ? last.querySelector('.dash-activity-label').textContent : null,
      righe: last ? Array.from(last.querySelectorAll('.dash-activity-row, .dash-activity-cmd')).map((r) => r.textContent) : [],
      bloccati: document.querySelectorAll('.dash-cmd-blocked').length,
      testoChat: document.querySelector('#bubbles') ? document.querySelector('#bubbles').innerText : '',
    };
  });
  console.log('TERMINALE-SPENTO', JSON.stringify(vista));
  expect(vista.testoChat, 'la chat spiega che la modalità terminale è spenta').toMatch(/terminale/i);
});

test('impostazione di livello 1: come la racconta il diario', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { toolCalls: [{ id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'tema', valore: 'scuro' }) }] },
    { text: 'Fatto.' },
  ]);
  await ask(page, 'metti il tema scuro');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Fatto.', { timeout: 20_000 });
  const act = await activityRows(page);
  console.log('RIGA-IMPOSTAZIONE', JSON.stringify(act.rows));
  const calls = await app.evaluate(() => globalThis.__v.calls);
  console.log('ESITO-AL-MODELLO', JSON.stringify(calls[1].messages.filter((m) => m.role === 'tool').map((m) => m.content)));
  expect(act.label).toContain("cambiato un'impostazione");
});

test('accoglienza: la spunta lascia riga, e il ricaricamento a metà', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  // accoglienza APERTA
  await setup(app, [
    {
      text: 'Piacere! Segno.',
      toolCalls: [{ id: 'o1', name: 'ONBOARDING', arguments: JSON.stringify({ spunta: ['profilo'] }) }],
    },
    { text: 'Benissimo, cominciamo.' },
    { text: 'Ancora qui.' },
  ]);
  await app.evaluate(async () => {
    const Onb = globalThis.SN_ONBOARDING;
    await globalThis.SN_FILO_MEMORY.setOnboarding(Onb.emptyState());
  });
  await page.reload();
  await page.waitForTimeout(1200);
  await expect(page.locator('#input')).toBeVisible();
  await ask(page, 'mi chiamo Sathya e faccio il pizzaiolo');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('cominciamo', { timeout: 25_000 });
  const act = await activityRows(page);
  console.log('ACCOGLIENZA-DIARIO', JSON.stringify(act));
  expect(act && act.rows.join(' | '), 'riga della spunta di accoglienza').toMatch(/Accoglienza/);

  // ricaricamento durante l'accoglienza: la conversazione torna, il blocco?
  await page.reload();
  await page.waitForTimeout(2000);
  const dopo = await page.evaluate(() => ({
    bolle: document.querySelectorAll('.dash-bubble').length,
    testo: document.querySelector('#bubbles') ? document.querySelector('#bubbles').innerText.slice(0, 300) : '',
    blocchi: document.querySelectorAll('.dash-activity').length,
  }));
  console.log('ACCOGLIENZA-DOPO-RELOAD', JSON.stringify(dopo));
  expect(dopo.bolle === 0 || dopo.blocchi > 0, 'accoglienza: o torna tutto o non torna niente').toBe(true);
});

test('cronologia AI: una voce per giro con le misure', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { text: 'Cerco.', toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'gatti' }) }] },
    { text: 'Ecco i gatti.' },
  ]);
  await ask(page, 'cerca gatti');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ecco i gatti', { timeout: 20_000 });
  const voci = await app.evaluate(async () => {
    const h = await globalThis.SN_HISTORY.list({ limit: 20 });
    const arr = Array.isArray(h) ? h : (h && h.items) || [];
    return arr.filter((x) => String(x.origin || '').includes('filo:chat')).map((x) => ({
      output: String(x.output || '').slice(0, 80), timing: x.timing,
    }));
  });
  console.log('CRONOLOGIA', JSON.stringify(voci));
  expect(voci.length, 'una voce per giro').toBe(2);
  expect(voci.every((v) => v.timing && typeof v.timing.totalMs === 'number'), 'misure presenti').toBe(true);
  expect(voci.some((v) => v.output.includes('Azioni:')), 'il giro di sole azioni dice quali').toBe(true);

  const hist = await openTab('filo://history');
  await expect(hist.locator('.sn-history-timing').first()).toBeVisible({ timeout: 10_000 });
});

test('«vai alla home» a metà turno: il blocco sopravvive?', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    {
      toolCalls: [
        { id: 'w1', name: 'TIMER', arguments: JSON.stringify({ secondi: 120, etichetta: 'uova' }) },
        { id: 'w2', name: 'COMANDO_FINESTRA', arguments: JSON.stringify({ comando: 'home' }) },
      ],
    },
    { text: 'Timer messo, e sei sulla home.' },
  ]);
  await ask(page, 'timer uova e portami alla home');
  await page.waitForTimeout(3000);
  const stato = await app.evaluate(() => ({ timers: globalThis.SN_FILO_MEMORY.listTimers() }));
  const vista = await page.evaluate(() => ({
    bolle: document.querySelectorAll('.dash-bubble').length,
    blocchi: document.querySelectorAll('.dash-activity').length,
    righe: Array.from(document.querySelectorAll('.dash-activity-row')).map((r) => r.textContent),
  })).catch((e) => ({ errore: String(e).slice(0, 120) }));
  console.log('VAI-ALLA-HOME', JSON.stringify(vista), JSON.stringify((await stato).timers ? '' : ''));
  expect(vista.blocchi === undefined || vista.blocchi > 0 || vista.bolle === 0, 'blocco e bolle coerenti').toBe(true);
});
