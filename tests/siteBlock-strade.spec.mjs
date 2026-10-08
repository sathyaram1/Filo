// Lista dei siti bloccati (#590): le strade che passano per nomi veri (motori, contatori,
// finestrelle di accesso), la storia della scheda e le schede già aperte. Rete finta: tests/helpers/reteFinta.mjs.

import { rmSync } from 'node:fs';
import { test, expect, lista, schede, finestre, apri, idAttiva, contaAvvisi, schedaSu, avviaFilo, chiudiApp, cartellaTemporanea } from './helpers/reteFinta.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

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

test('«Apri» sull\'avviso del popup non scavalca la lista dei siti bloccati', async ({ app, shell, rete, avvisi: vista }) => {
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO DELLA LISTA</h1>');
  const pagina = rete.pagina('sito.test', '/', `<button id="b" onclick="window.open('${bersaglio}', 'p', 'width=400,height=300')">pop</button>`);
  await apri(app, shell, pagina);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.click('#b');
  const chip = (await vista()).locator('.shell-notif', { hasText: 'Bloccato popup' }).first();
  await expect(chip).toBeVisible({ timeout: 6000 });
  await chip.locator('.shell-notif-action', { hasText: 'Apri' }).click();
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

test('dalla pagina «Sito bloccato» si arriva alla lista, e tolto il sito da lì la scheda torna sul sito', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await apri(app, shell, sito);
  await lista(shell, ['blocked.test']);
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
  await paginaBloccata(app).locator('a', { hasText: 'Gestisci i siti bloccati' }).click();
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://security/')), { timeout: 6000 }).toBe(true);
  const sicurezza = app.windows().find((w) => w.url().startsWith('filo://security/'));
  const campo = sicurezza.locator('#sec-siteblock-blacklist');
  await expect(campo).toHaveValue('blocked.test', { timeout: 6000 });
  await campo.fill('');
  await campo.dispatchEvent('change');
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toBe(sito);
});

// La lista si salva mentre si scrive (#590.2): una riga a metà correzione non riapre il sito.
async function bloccataConSicurezza(app, shell, rete) {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await apri(app, shell, sito);
  const id = await idAttiva(app);
  await lista(shell, ['blocked.test']);
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
  await app.evaluate(({ BrowserWindow }, i) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs.find((x) => x.id === i);
    globalThis.__aperture590 = [];
    t.view.webContents.on('did-navigate', (_e, u) => globalThis.__aperture590.push(u));
  }, id);
  const pref = await paginaSicurezza(app, shell);
  const campo = pref.locator('#sec-siteblock-blacklist');
  await expect(campo).toHaveValue('blocked.test', { timeout: 6000 });
  await campo.click();
  await pref.keyboard.press('Control+End');
  await pref.waitForTimeout(600);
  return { sito, id, pref, aperture: () => app.evaluate(() => globalThis.__aperture590.filter((u) => !u.startsWith('filo://'))) };
}

test('tolta e riscritta l\'ultima lettera del sito nella lista, la scheda ferma sulla pagina «Sito bloccato» non lo riapre', async ({ app, shell, rete }) => {
  const { pref, aperture } = await bloccataConSicurezza(app, shell, rete);
  await pref.keyboard.press('Backspace');
  await pref.waitForTimeout(1200);
  await pref.keyboard.type('t');
  await pref.waitForTimeout(4000);
  expect(await pref.locator('#sec-siteblock-blacklist').inputValue()).toBe('blocked.test');
  expect(await aperture()).toEqual([]);
  expect(await caricataSu(app, 'blocked.test')).toMatch(PAGINA_BLOCCATA);
});

test('tolto il sito dalla lista scrivendo e tornati subito sulla sua scheda, il sito c\'è già', async ({ app, shell, rete }) => {
  const { sito, id, pref } = await bloccataConSicurezza(app, shell, rete);
  await pref.keyboard.press('Control+A');
  await pref.keyboard.press('Delete');
  await pref.waitForTimeout(700);
  await shell.evaluate((i) => window.filoShell.tabs.activate(i), id);
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 1500 }).toBe(sito);
});

test('scrivendo «blocked.test.it» con una pausa dopo «blocked.test», la scheda aperta su blocked.test resta com\'è', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await apri(app, shell, sito);
  const id = await idAttiva(app);
  await app.evaluate(({ BrowserWindow }, i) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs.find((x) => x.id === i);
    globalThis.__aperture590b = [];
    t.view.webContents.on('did-navigate', (_e, u) => globalThis.__aperture590b.push(u));
  }, id);
  const pref = await paginaSicurezza(app, shell);
  const campo = pref.locator('#sec-siteblock-blacklist');
  await campo.click();
  await pref.keyboard.type('blocked.test', { delay: 30 });
  await pref.waitForTimeout(1000);
  await pref.keyboard.type('.it', { delay: 30 });
  await pref.waitForTimeout(4500);
  expect(await campo.inputValue()).toBe('blocked.test.it');
  expect(await app.evaluate(() => globalThis.__aperture590b)).toEqual([]);
  expect(await caricataSu(app, 'blocked.test')).toBe(sito);
});

async function apertaConSicurezza(app, shell, rete) {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await apri(app, shell, sito);
  const id = await idAttiva(app);
  const pref = await paginaSicurezza(app, shell);
  await pref.locator('#sec-siteblock-blacklist').click();
  await pref.keyboard.type('blocked.test', { delay: 30 });
  return { id, pref };
}

test('scritto per intero il sito di una scheda aperta, la scheda passa alla pagina «Sito bloccato» appena la riga sta ferma', async ({ app, shell, rete }) => {
  await apertaConSicurezza(app, shell, rete);
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
});

test('scritto il sito di una scheda aperta e tornati subito su quella scheda, è già sulla pagina «Sito bloccato»', async ({ app, shell, rete }) => {
  const { id, pref } = await apertaConSicurezza(app, shell, rete);
  await pref.waitForTimeout(700);
  await shell.evaluate((i) => window.filoShell.tabs.activate(i), id);
  await expect.poll(() => caricataSu(app, 'blocked.test'), { timeout: 1500 }).toMatch(PAGINA_BLOCCATA);
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

test('un sito messo in lista mentre una scheda ci sta ancora arrivando: la scheda finisce sulla pagina «Sito bloccato»', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const lento = rete.pagina('blocked.test', '/lento', '<h1>SITO</h1>', { ritardoMs: 2500 });
  const partenza = rete.pagina('sito.test', '/', '<h1>PARTENZA</h1>');
  await apri(app, shell, partenza);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.evaluate((u) => { location.href = u; }, lento);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), lento);
  await shell.waitForTimeout(500);
  await lista(shell, ['blocked.test']);
  const suQuelSito = async () => (await schede(app)).filter((u) => u.includes('blocked.test'));
  await expect.poll(async () => (await suQuelSito()).filter((u) => PAGINA_BLOCCATA.test(u)).length, { timeout: 8000 }).toBe(2);
  expect(await aperteSu(app, 'http://blocked.test')).toEqual([]);
});

test('alla riapertura di Filo una scheda su un sito della lista torna sulla pagina «Sito bloccato»', async ({ rete }) => {
  const userData = cartellaTemporanea('filo-test-');
  const avvia = async () => {
    const app = await avviaFilo(rete, userData);
    const shell = await primaFinestra(app);
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

test('liste pubbliche: «Apri comunque» su un contatore di clic porta all\'articolo, non a una pagina d\'errore', async ({ app, shell, rete, avvisi }) => {
  await app.evaluate(() => { globalThis.__filoAdblock.setDomainsForTest(['tracker.test']); });
  const articolo = rete.pagina('articolo.test', '/', '<h1>ARTICOLO</h1>');
  const contatore = rete.rimbalzo('tracker.test', '/c', articolo);
  const link = rete.rimbalzo('accorcia.test', '/n', contatore);
  const pagina = rete.pagina('sito.test', '/', `<a id="go" href="${link}">leggi</a>`);
  await apri(app, shell, pagina);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.evaluate(() => document.getElementById('go').click());
  const card = (await avvisi()).locator('.shell-notif', { hasText: 'Sito bloccato' }).first();
  await expect(card).toBeVisible({ timeout: 6000 });
  await card.locator('.shell-notif-action', { hasText: 'Apri comunque' }).click();
  await expect.poll(async () => (await aperteSu(app, 'articolo.test')).length, { timeout: 8000 }).toBe(1);
  expect((await schede(app)).filter((u) => u.startsWith('filo://error'))).toEqual([]);
});

// Le notifiche «Sito bloccato» nate nella shell (non i messaggi mandati: la shell tiene una sola notifica per sito a schermo).
async function contaCarte(shell) {
  await shell.evaluate(() => {
    window.__carte590 = 0;
    new MutationObserver((m) => {
      for (const r of m) for (const n of r.addedNodes) {
        if (n.classList && n.classList.contains('shell-notif') && /Sito bloccato/.test(n.textContent)) window.__carte590 += 1;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  return () => shell.evaluate(() => window.__carte590);
}

test('una pagina che riprova in continuazione non riempie l\'angolo di notifiche', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const carte = await contaCarte(shell);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>X</h1>');
  const pagina = rete.pagina('sito.test', '/', `<h1>insiste</h1><script>setInterval(() => { location.href = ${JSON.stringify(bersaglio)}; }, 150)</script>`);
  await apri(app, shell, pagina);
  await shell.waitForTimeout(5000);
  expect(await carte()).toBeLessThanOrEqual(2);
  await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' })).toHaveCount(1);
});

test('chiusa la notifica «Sito bloccato», il secondo tentativo lo dice di nuovo', async ({ app, shell, rete, avvisi: vista }) => {
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const pagina = rete.pagina('sito.test', '/', `<a id="go" href="${bersaglio}">vai</a>`);
  await apri(app, shell, pagina);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.waitForSelector('#go');
  const avvisi = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await tab.evaluate(() => document.getElementById('go').click());
  await expect(avvisi).toHaveCount(1, { timeout: 6000 });
  const aSchermo = (await vista()).locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(aSchermo.first()).toBeVisible({ timeout: 6000 });
  await aSchermo.first().locator('.shell-notif-close').click();
  await expect(avvisi).toHaveCount(0, { timeout: 3000 });
  await tab.evaluate(() => document.getElementById('go').click());
  await expect(aSchermo.first()).toBeVisible({ timeout: 3000 });
  expect(tab.url()).toBe(pagina);
});

test('«Apri comunque» premuto due volte apre una scheda sola', async ({ app, shell, rete, avvisi }) => {
  await lista(shell, ['blocked.test']);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), sito);
  const card = (await avvisi()).locator('.shell-notif', { hasText: 'Sito bloccato' }).first();
  await expect(card).toBeVisible({ timeout: 6000 });
  await card.locator('.shell-notif-action', { hasText: 'Apri comunque' }).dblclick();
  await expect.poll(async () => (await aperteSu(app, 'blocked.test')).length, { timeout: 6000 }).toBeGreaterThan(0);
  await shell.waitForTimeout(1500);
  expect(await aperteSu(app, 'blocked.test')).toHaveLength(1);
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

async function paginaSicurezza(app, shell) {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  await expect.poll(() => !!app.windows().find((w) => w.url().startsWith('filo://security')), { timeout: 8000 }).toBe(true);
  const p = app.windows().find((w) => w.url().startsWith('filo://security'));
  await p.waitForLoadState('domcontentloaded');
  return p;
}

async function scriviLista(pagina, testo) {
  const campo = pagina.locator('#sec-siteblock-blacklist');
  await campo.scrollIntoViewIfNeeded();
  await campo.fill(testo);
  await campo.dispatchEvent('change');
  await pagina.waitForTimeout(600);
}

test('Preferenze: la descrizione non promette eccezioni, e un sito con estensione non latina entra in lista e blocca', async ({ app, shell, rete }) => {
  const RF = 'xn--80aswg.xn--p1ai';
  rete.pagina(RF, '/', '<h1>SITO RF</h1>');
  const pref = await paginaSicurezza(app, shell);
  await expect(pref.locator('#sec-siteblock-desc')).not.toContainText('motore di ricerca');
  await expect(pref.locator('#sec-siteblock-desc')).not.toContainText('lo apre Filo per te');
  await scriviLista(pref, 'сайт.рф\nmünchen.de');
  await expect(pref.locator('#sec-siteblock-blacklist-error')).toBeHidden();

  const avvisi = await contaAvvisi(app);
  await shell.evaluate(() => window.filoShell.tabs.open('http://сайт.рф/'));
  await expect.poll(async () => (await avvisi()).join(' '), { timeout: 6000 }).toContain('Sito bloccato: сайт.рф');
  expect(await aperteSu(app, RF)).toEqual([]);

  // Si salva nella forma «xn--», si rilegge come l'utente l'ha scritto.
  await pref.reload();
  await pref.waitForLoadState('domcontentloaded');
  await expect(pref.locator('#sec-siteblock-blacklist')).toHaveValue('сайт.рф\nmünchen.de', { timeout: 6000 });
});

test('Preferenze: «.sito.it» e «*.sito.it» valgono «sito.it» e bloccano', async ({ app, shell, rete }) => {
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const altro = rete.pagina('www.blocked.test', '/', '<h1>WWW</h1>');
  const pref = await paginaSicurezza(app, shell);
  for (const voce of ['.blocked.test', '*.blocked.test']) {
    await scriviLista(pref, voce);
    await expect(pref.locator('#sec-siteblock-blacklist-error')).toBeHidden();
    const avvisi = await contaAvvisi(app);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), sito);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), altro);
    await expect.poll(async () => (await avvisi()).length, { timeout: 6000 }).toBeGreaterThan(0);
    await shell.waitForTimeout(800);
    expect(await aperteSu(app, 'blocked.test/'), voce).toEqual([]);
  }
});

test('Preferenze: una seconda pagina Sicurezza aperta da prima non riscrive la lista cambiata nell\'altra', async ({ app, shell }) => {
  const listaSalvata = () => app.evaluate(async () => ((await globalThis.SN_STORAGE.getSettings()).security?.siteBlock || {}).blacklist || []);
  await paginaSicurezza(app, shell);
  await shell.evaluate((i) => window.filoShell.tabs.duplicate(i), await idAttiva(app));
  await expect.poll(() => app.windows().filter((w) => w.url().startsWith('filo://security')).length, { timeout: 8000 }).toBe(2);
  const [prima, seconda] = app.windows().filter((w) => w.url().startsWith('filo://security'));
  await prima.waitForSelector('#sec-siteblock-blacklist');
  await seconda.waitForSelector('#sec-block-popups');
  await seconda.waitForTimeout(800);
  await scriviLista(prima, 'blocked.test');
  await expect.poll(listaSalvata, { timeout: 4000 }).toEqual(['blocked.test']);
  await seconda.evaluate(() => {
    const c = document.getElementById('sec-block-popups');
    c.checked = !c.checked;
    c.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await seconda.waitForTimeout(1200);
  expect(await listaSalvata()).toEqual(['blocked.test']);
});

test('un nome con lettere accentate si legge come è scritto nella pagina «Sito bloccato» e nel titolo della scheda', async ({ app, shell, rete }) => {
  const MUENCHEN = 'xn--mnchen-3ya.de';
  await lista(shell, []);
  const sito = rete.pagina(MUENCHEN, '/', '<h1>MUENCHEN</h1>');
  await apri(app, shell, sito);
  await lista(shell, ['münchen.de']);
  await expect.poll(() => caricataSu(app, MUENCHEN), { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
  const pagina = paginaBloccata(app);
  await expect(pagina.locator('#err-host')).toHaveText('münchen.de');
  await expect(pagina).toHaveTitle('münchen.de');
});

const finestrelle = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((w) => !w._filoTabs && w.isVisible()).map((w) => w.webContents.getURL()));

async function apertoComunque(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.openBlockedPopup(u, true), url);
  await expect.poll(() => app.windows().some((w) => w.url() === url), { timeout: 8000 }).toBe(true);
  return app.windows().find((w) => w.url() === url);
}

test('dentro un sito aperto con «Apri comunque» le sue finestrelle di accesso si aprono, dritte o dopo un rimbalzo', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const accesso = rete.pagina('blocked.test', '/oauth/authorize', '<h1>ACCESSO DEL SITO</h1>') + '?client_id=a&response_type=code';
  const login = rete.rimbalzo('blocked.test', '/login', accesso);
  const sito = rete.pagina('blocked.test', '/', `<h1>SITO</h1>
    <button id="diretta" onclick="window.open('${accesso}', 'a1', 'width=500,height=400')">accedi</button>
    <button id="rimbalzo" onclick="window.open('${login}', 'a2', 'width=500,height=400')">accedi</button>`);
  const tab = await apertoComunque(app, shell, sito);
  await tab.click('#diretta');
  await expect.poll(() => finestrelle(app), { timeout: 6000 }).toEqual([accesso]);
  await tab.click('#rimbalzo');
  await expect.poll(() => finestrelle(app), { timeout: 6000 }).toEqual([accesso, accesso]);
});

test('dentro un sito aperto con «Apri comunque», «Apri» sull\'avviso del popup apre il popup di quel sito', async ({ app, shell, rete, avvisi: vista }) => {
  await lista(shell, ['blocked.test']);
  const pop = rete.pagina('blocked.test', '/pop', '<h1>POPUP DEL SITO</h1>');
  const sito = rete.pagina('blocked.test', '/', `<h1>SITO</h1><button id="b" onclick="window.open('${pop}', 'p', 'width=400,height=300')">pop</button>`);
  const tab = await apertoComunque(app, shell, sito);
  const avvisi = await contaAvvisi(app);
  await tab.click('#b');
  const chip = (await vista()).locator('.shell-notif', { hasText: 'Bloccato popup' }).first();
  await expect(chip).toBeVisible({ timeout: 6000 });
  await chip.locator('.shell-notif-action', { hasText: 'Apri' }).click();
  await expect.poll(async () => (await schede(app)).includes(pop), { timeout: 6000 }).toBe(true);
  expect(await avvisi()).toEqual([]);
});


test('modalità privacy: un link che passa da un accorciatore e rimbalza sul sito della lista lascia la pagina di prima, non una scheda vuota', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { security: { cookies: { mode: 'privacy' } } } }));
  await shell.waitForTimeout(400);
  const avvisi = await contaAvvisi(app);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const corto = rete.rimbalzo('accorcia.test', '/r', bersaglio);
  const pagina = rete.pagina('sito.test', '/', `<h1>PAGINA</h1><a id="l" href="${corto}">link</a>`);
  await apri(app, shell, pagina);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.click('#l');
  await expect.poll(async () => (await schede(app)).includes(pagina), { timeout: 8000 }).toBe(true);
  await shell.waitForTimeout(800);
  expect((await schede(app)).filter((u) => u === '' || u.includes('blocked.test'))).toEqual([]);
  expect((await avvisi()).length).toBeGreaterThan(0);
});
