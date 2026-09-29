// Lista dei siti bloccati (#590): le strade che passano per nomi veri (motori, contatori,
// finestrelle di accesso), la storia della scheda e le schede già aperte. Rete finta: tests/helpers/reteFinta.mjs.

import { rmSync } from 'node:fs';
import { test, expect, lista, schede, finestre, apri, idAttiva, contaAvvisi, schedaSu, avviaFilo, chiudiApp, cartellaTemporanea } from './helpers/reteFinta.mjs';

const aperteSu = async (app, host) => (await schede(app)).filter((u) => u.includes(host));
const PAGINA_BLOCCATA = /^filo:\/\/error\/error\.html\?.*code=blocked/;
const caricataSu = async (app, host) => ((await schedaSu(app, host)) || {}).caricata || '';
const paginaBloccata = (app) => app.windows().find((w) => PAGINA_BLOCCATA.test(w.url()));

test('una finestrella di accesso aperta dalla pagina verso il sito della lista non nasce, e lo si dice', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const accesso = rete.pagina('blocked.test', '/dialog', '<h1>SITO DELLA LISTA</h1>') + '?client_id=x&response_type=code&redirect_uri=y';
  const pagina = rete.pagina('sito.test', '/', `<h1>pagina</h1><script>setTimeout(() => window.open(${JSON.stringify(accesso)}, 'accesso', 'width=500,height=400'), 300)</script>`);
  await apri(app, shell, pagina);
  await shell.waitForTimeout(2500);
  expect((await finestre(app)).filter((u) => u.includes('blocked.test'))).toEqual([]);
  expect((await avvisi()).length).toBeGreaterThan(0);
});

test('una finestrella di accesso che il server rimbalza sul sito della lista si chiude, non resta vuota', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO DELLA LISTA</h1>');
  const accesso = rete.rimbalzo('sito.test', '/login', bersaglio);
  const pagina = rete.pagina('articolo.test', '/', `<button id="b" onclick="window.open('${accesso}', 'accesso', 'width=500,height=400')">accedi</button>`);
  await apri(app, shell, pagina);
  const prima = (await finestre(app)).length;
  const tab = app.windows().find((w) => w.url().includes('articolo.test'));
  await tab.click('#b');
  await shell.waitForTimeout(2500);
  expect((await finestre(app)).filter((u) => u.includes('blocked.test'))).toEqual([]);
  expect((await finestre(app)).length).toBeLessThanOrEqual(prima);
  expect((await avvisi()).length).toBeGreaterThan(0);
});

test('«Apri» sulla chip dei popup non scavalca la lista dei siti bloccati', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO DELLA LISTA</h1>');
  const pagina = rete.pagina('sito.test', '/', `<button id="b" onclick="window.open('${bersaglio}', 'p', 'width=400,height=300')">pop</button>`);
  await apri(app, shell, pagina);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.click('#b');
  const chip = shell.locator('.popup-chip').first();
  await expect(chip).toBeVisible({ timeout: 6000 });
  await chip.locator('button', { hasText: 'Apri' }).click();
  await shell.waitForTimeout(2000);
  expect(await aperteSu(app, 'blocked.test')).toEqual([]);
  expect((await avvisi()).length).toBeGreaterThan(0);
});

test('dai risultati di una ricerca il sito della lista si ferma, cliccato o aperto in una scheda nuova', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO CERCATO</h1>');
  const r = rete.rimbalzo('accorcia.test', '/r', bersaglio);
  const risultati = rete.pagina('www.bing.com', '/search', `<a id="diretto" href="${bersaglio}">risultato</a> <a id="nuova" target="_blank" href="${r}">risultato</a>`);
  await apri(app, shell, risultati);
  const tab = app.windows().find((w) => w.url().includes('www.bing.com'));
  await tab.evaluate(() => document.getElementById('nuova').click());
  await shell.waitForTimeout(1500);
  await tab.evaluate(() => document.getElementById('diretto').click());
  await shell.waitForTimeout(1500);
  expect(await aperteSu(app, 'blocked.test')).toEqual([]);
  expect(tab.url()).toContain('www.bing.com/search');
  expect((await avvisi()).length).toBeGreaterThan(0);
});

test('indietro verso un sito messo in lista nel frattempo: fermato e detto', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const altro = rete.pagina('sito.test', '/', '<h1>ALTRO</h1>');
  await apri(app, shell, sito);
  const id = await idAttiva(app);
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, altro]);
  await expect.poll(async () => (await aperteSu(app, 'sito.test')).length, { timeout: 6000 }).toBe(1);
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  await shell.evaluate((i) => window.filoShell.tabs.back(i), id);
  await shell.waitForTimeout(2000);
  expect(await aperteSu(app, 'blocked.test')).toEqual([]);
  expect((await avvisi()).length).toBeGreaterThan(0);
});

test('un sito messo in lista mentre lo si guarda passa subito alla pagina «Sito bloccato», e «Apri comunque» lì lo riapre', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await apri(app, shell, sito);
  await lista(shell, ['blocked.test']);
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
  expect((await schedaSu(app, 'blocked.test')).url).toBe(sito);
  const pagina = paginaBloccata(app);
  await expect(pagina.locator('h1')).toHaveText('Sito bloccato');
  await expect(pagina.locator('#err-host')).toHaveText('blocked.test');
  await pagina.screenshot({ path: 'tests/.shots/590-sito-bloccato.png' });

  // La copia di quella scheda è ancora la pagina «Sito bloccato», non il sito.
  const { id } = await schedaSu(app, 'blocked.test');
  await shell.evaluate((i) => window.filoShell.tabs.duplicate(i), id);
  await shell.waitForTimeout(1500);
  expect(await aperteSu(app, 'http://blocked.test')).toEqual([]);

  const avvisi = await contaAvvisi(app);
  await pagina.locator('button', { hasText: 'Apri comunque' }).click();
  await expect.poll(async () => (await aperteSu(app, 'http://blocked.test')).length, { timeout: 6000 }).toBe(1);
  const riaperta = (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs
    .filter((t) => t.view.webContents.getURL().startsWith('http://blocked.test')).map((t) => t.id)))[0];
  expect(riaperta).toBe(id);
  await shell.evaluate((i) => window.filoShell.tabs.reload(i), id);
  await shell.waitForTimeout(1500);
  expect(await caricataSu(app, 'blocked.test')).toBe(sito);
  expect(await avvisi()).toEqual([]);
});

test('indietro dalla pagina «Sito bloccato» torna alla pagina di prima; tolto dalla lista, il sito torna', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const prima = rete.pagina('sito.test', '/', '<h1>PRIMA</h1>');
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await apri(app, shell, prima);
  const id = await idAttiva(app);
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, sito]);
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toBe(sito);
  await lista(shell, ['blocked.test']);
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
  await shell.waitForTimeout(500);
  await shell.evaluate((i) => window.filoShell.tabs.back(i), id);
  await expect.poll(() => caricataSu(app, 'sito.test'), { timeout: 6000 }).toBe(prima);

  await shell.evaluate((i) => window.filoShell.tabs.forward(i), id);
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
  await lista(shell, []);
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toBe(sito);
});

test('alla riapertura di Filo una scheda su un sito della lista torna sulla pagina «Sito bloccato»', async ({ rete }) => {
  const userData = cartellaTemporanea('filo-test-');
  const avvia = async () => {
    const app = await avviaFilo(rete, userData);
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    return { app, shell };
  };
  let app = null;
  try {
    const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
    let shell;
    ({ app, shell } = await avvia());
    await apri(app, shell, sito);
    await lista(shell, ['blocked.test']);
    await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
    await shell.waitForTimeout(1500); // la sessione si salva con un attimo di ritardo
    await chiudiApp(app);

    ({ app, shell } = await avvia());
    await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 10000 }).toMatch(PAGINA_BLOCCATA);
    await shell.waitForTimeout(1000);
    expect(await aperteSu(app, 'http://blocked.test')).toEqual([]);
    const { id } = await schedaSu(app, 'blocked.test');
    await shell.evaluate((i) => window.filoShell.tabs.activate(i), id);
    await expect.poll(() => !!paginaBloccata(app), { timeout: 6000 }).toBe(true);
    await paginaBloccata(app).locator('button', { hasText: 'Apri comunque' }).click();
    await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toBe(sito);
  } finally {
    if (app) await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('liste pubbliche: «Apri comunque» della pagina «Sito bloccato» apre davvero il sito, non una pagina d\'errore', async ({ app, shell, rete }) => {
  await lista(shell, [], { useAdblockLists: false });
  const tracker = rete.pagina('tracker.test', '/', '<h1>TRACKER</h1>');
  await apri(app, shell, tracker);
  await app.evaluate(() => { globalThis.__filoAdblock.setDomainsForTest(['tracker.test']); });
  await lista(shell, [], { useAdblockLists: true });
  await expect.poll(() => caricataSu(app, 'tracker.test'), { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
  await paginaBloccata(app).locator('button', { hasText: 'Apri comunque' }).click();
  await expect.poll(() => caricataSu(app, 'tracker.test'), { timeout: 6000 }).toBe(tracker);
  await expect(app.windows().find((w) => w.url() === tracker).locator('h1')).toHaveText('TRACKER');
});

test('liste pubbliche: «Apri comunque» su un contatore di clic porta all\'articolo, non a una pagina d\'errore', async ({ app, shell, rete }) => {
  await app.evaluate(() => { globalThis.__filoAdblock.setDomainsForTest(['tracker.test']); });
  const articolo = rete.pagina('articolo.test', '/', '<h1>ARTICOLO</h1>');
  const contatore = rete.rimbalzo('tracker.test', '/c', articolo);
  const link = rete.rimbalzo('accorcia.test', '/n', contatore);
  const pagina = rete.pagina('sito.test', '/', `<a id="go" href="${link}">leggi</a>`);
  await apri(app, shell, pagina);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.evaluate(() => document.getElementById('go').click());
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first();
  await expect(card).toBeVisible({ timeout: 6000 });
  await card.locator('.shell-notif-action', { hasText: 'Apri comunque' }).click();
  await expect.poll(async () => (await aperteSu(app, 'articolo.test')).length, { timeout: 8000 }).toBe(1);
  expect((await schede(app)).filter((u) => u.startsWith('filo://error'))).toEqual([]);
});

test('una pagina che riprova in continuazione non riempie l\'angolo di notifiche', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>X</h1>');
  const pagina = rete.pagina('sito.test', '/', `<h1>insiste</h1><script>setInterval(() => { location.href = ${JSON.stringify(bersaglio)}; }, 150)</script>`);
  await apri(app, shell, pagina);
  await shell.waitForTimeout(5000);
  expect((await avvisi()).length).toBeLessThanOrEqual(2);
});

test('un indirizzo senza schema (come a volte lo manda il modello) porta la scheda a quell\'indirizzo', async ({ app, shell }) => {
  await shell.waitForTimeout(1000);
  const out = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const id = w._filoTabs.openTab('libero.test/pagina', { activate: true });
    await new Promise((r) => setTimeout(r, 3000));
    const t = w._filoTabs.tabs.find((x) => x.id === id);
    return t ? t.view.webContents.getURL() : null;
  });
  expect(decodeURIComponent(out || '')).toContain('libero.test/pagina');
});
