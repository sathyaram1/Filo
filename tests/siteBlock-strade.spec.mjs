// Lista dei siti bloccati (#590): le strade che passano per nomi veri (motori, contatori,
// finestrelle di accesso) e per la storia della scheda. Rete finta: tests/helpers/reteFinta.mjs.

import { test, expect, lista, schede, finestre, apri, idAttiva, contaAvvisi } from './helpers/reteFinta.mjs';

const aperteSu = async (app, host) => (await schede(app)).filter((u) => u.includes(host));

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

for (const [nome, host, path] of [
  ['un nome «searx» su un\'estensione qualunque', 'searx.xyz', '/search'],
  ['una pagina di Google Sites', 'sites.google.com', '/view/pagina'],
  ['un articolo sul sottodominio degli autori di Baidu', 'baijiahao.baidu.com', '/s'],
]) {
  test(`l'eccezione della ricerca non la prende ${nome}`, async ({ app, shell, rete }) => {
    await lista(shell, ['blocked.test']);
    const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO DELLA LISTA</h1>');
    const partenza = rete.pagina(host, path, `<h1>pagina</h1><script>setTimeout(() => { location.href = ${JSON.stringify(bersaglio)}; }, 500)</script>`);
    await apri(app, shell, partenza);
    await shell.waitForTimeout(2500);
    expect(await aperteSu(app, 'blocked.test')).toEqual([]);
  });
}

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

test('un risultato di ricerca che rimbalza arriva anche aperto in una scheda nuova', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO CERCATO</h1>');
  const r = rete.rimbalzo('accorcia.test', '/r', bersaglio);
  const risultati = rete.pagina('www.bing.com', '/search', `<a id="nuova" target="_blank" href="${r}">risultato</a>`);
  await apri(app, shell, risultati);
  const tab = app.windows().find((w) => w.url().includes('www.bing.com'));
  await tab.evaluate(() => document.getElementById('nuova').click());
  await expect.poll(async () => (await aperteSu(app, 'blocked.test')).length, { timeout: 6000 }).toBe(1);
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

test('ricaricare un sito messo in lista mentre lo si guarda lo dice; uno aperto con «Apri comunque» si ricarica', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await apri(app, shell, sito);
  const id = await idAttiva(app);
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  await shell.evaluate((i) => window.filoShell.tabs.reload(i), id);
  await shell.waitForTimeout(1500);
  expect((await avvisi()).length).toBe(1);

  await shell.evaluate((u) => window.filoShell.tabs.openBlockedPopup(u, true), sito);
  await expect.poll(async () => (await aperteSu(app, 'blocked.test')).length, { timeout: 6000 }).toBe(2);
  const id2 = await idAttiva(app);
  await shell.waitForTimeout(4200); // oltre la finestra in cui lo stesso sito non si ri-notifica
  await shell.evaluate((i) => window.filoShell.tabs.reload(i), id2);
  await shell.waitForTimeout(1500);
  expect((await avvisi()).length).toBe(1);
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
