// #685 — chi arriva da un browser qualsiasi prova Alt+← e Alt+→, e in Filo non
// succedeva niente: indietro e avanti si raggiungevano solo dal menu del tasto
// destro (dentro «Altro…») e con Ctrl+Z per il solo indietro.
//
// Qui si asserisce il SUCCESSO dal punto di vista di chi ha segnalato: premo il
// tasto e la scheda è tornata alla pagina di prima. Senza il fix ogni assert è
// rosso, perché la scheda resta dov'era.
//
// Il caso che distingue questa strada da Ctrl+Z ha un test suo: con un campo di
// testo a fuoco Ctrl+Z deve annullare, Alt+← deve navigare lo stesso — è così
// in ogni browser, ed è il motivo per cui il tasto si intercetta nel main e non
// nel content script.

import { test, expect } from './fixtures/electron.mjs';

// Il tasto si inietta sulla webContents che lo riceverebbe davvero: è lo stesso
// cammino del tasto reale (before-input-event nel main), ma deterministico in
// headless, dove la finestra non ha il fuoco del sistema. Stessa scelta di
// tests/tab-numeric-shortcuts.spec.mjs.
function premiNellaPagina(app, keyCode, modifiers = ['alt']) {
  return app.evaluate(({ BrowserWindow }, arg) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: arg.keyCode, modifiers: arg.modifiers });
  }, { keyCode, modifiers });
}

function premiSullaBarra(app, keyCode, modifiers = ['alt']) {
  return app.evaluate(({ BrowserWindow }, arg) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: arg.keyCode, modifiers: arg.modifiers });
  }, { keyCode, modifiers });
}

const PAGE_A = '<!doctype html><title>A</title><h1 id="mark-a">pagina A</h1>';
const PAGE_B = '<!doctype html><title>B</title><h1 id="mark-b">pagina B</h1>'
  + '<input id="box" type="text">';

async function navigateAndReady(page, url) {
  await page.evaluate((u) => { window.location.href = u; }, url);
  await page.waitForURL(url, { timeout: 10_000 });
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null,
    { timeout: 8_000 },
  );
}

// Porta la scheda su A e poi su B: da lì "indietro" ha una destinazione
// verificabile per URL, e "avanti" ne ha una al ritorno.
async function scheda_con_A_e_B({ openTab, testServer }) {
  const urlA = testServer.html(PAGE_A);
  const urlB = testServer.html(PAGE_B);
  const page = await testServer.openReady(openTab, PAGE_A);
  await navigateAndReady(page, urlA);
  await navigateAndReady(page, urlB);
  await expect(page.locator('#mark-b')).toBeVisible();
  return { page, urlA, urlB };
}

test('Alt+\u2190 torna alla pagina precedente e Alt+\u2192 ci riporta avanti', async ({ app, openTab, testServer }) => {
  const { page, urlA, urlB } = await scheda_con_A_e_B({ openTab, testServer });

  await page.locator('#mark-b').click();
  await premiNellaPagina(app, 'Left');

  await page.waitForURL(urlA, { timeout: 8_000 });
  await expect(page.locator('#mark-a')).toBeVisible();

  await premiNellaPagina(app, 'Right');

  await page.waitForURL(urlB, { timeout: 8_000 });
  await expect(page.locator('#mark-b')).toBeVisible();
});

test('Alt+\u2190 naviga anche con un campo di testo a fuoco', async ({ app, openTab, testServer }) => {
  const { page, urlA } = await scheda_con_A_e_B({ openTab, testServer });

  const box = page.locator('#box');
  await box.click();
  await box.fill('sto scrivendo');
  await expect(box).toBeFocused();

  await premiNellaPagina(app, 'Left');

  // SUCCESSO = la scheda \u00e8 tornata su A. (Ctrl+Z qui annullerebbe il testo, ed
  // \u00e8 giusto cos\u00ec: sono due tasti con due significati diversi.)
  await page.waitForURL(urlA, { timeout: 8_000 });
  await expect(page.locator('#mark-a')).toBeVisible();
});

test('Alt+\u2190 vale anche col fuoco sulla barra di Filo', async ({ app, openTab, testServer }) => {
  const { page, urlA } = await scheda_con_A_e_B({ openTab, testServer });

  // Dopo un clic su una scheda il fuoco non \u00e8 pi\u00f9 nella pagina: da l\u00ec i tasti
  // della shell erano gi\u00e0 morti una volta (#404), e non devono morire di nuovo.
  await premiSullaBarra(app, 'Left');

  await page.waitForURL(urlA, { timeout: 8_000 });
  await expect(page.locator('#mark-a')).toBeVisible();
});

test('senza niente dove andare, Alt+\u2190 e Alt+\u2192 non fanno niente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE_A);
  const partenza = page.url();

  await premiNellaPagina(app, 'Left');
  await premiNellaPagina(app, 'Right');
  await page.waitForTimeout(800);

  // Nessun errore e nessun effetto: la pagina \u00e8 viva e non si \u00e8 mossa.
  expect(page.url()).toBe(partenza);
  await expect(page.locator('#mark-a')).toBeVisible();
});

test('vale anche sulle pagine di Filo, non solo sui siti', async ({ app, openTab }) => {
  // Due pagine interne diverse (e nessuna delle due è la newtab, che al boot
  // esiste già e confonderebbe la scheda su cui stiamo lavorando).
  const page = await openTab('filo://history/history.html');
  await page.waitForLoadState('domcontentloaded');
  const partenza = page.url();

  await page.evaluate(() => { window.location.href = 'filo://options/options.html'; });
  await page.waitForURL(/filo:\/\/options\//, { timeout: 10_000 });

  await premiNellaPagina(app, 'Left');

  await page.waitForURL(partenza, { timeout: 8_000 });
  expect(page.url()).toBe(partenza);
});

// ── Su Mac anche Cmd+← e Cmd+→ (#685.1) ─────────────────────────────────────
// Lì Cmd+freccia in un campo di testo porta il cursore a inizio o fine riga:
// naviga solo quando non si scrive. Il main fa il Mac per davvero (la regola
// legge `process.platform`); il movimento del cursore resta del sistema, e qui
// non si vede.
function diventaMac(app) {
  return app.evaluate(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  });
}

const PAGE_C = '<!doctype html><title>C</title><h1 id="mark-c">pagina C</h1>'
  + '<input id="box" type="text"><iframe id="fr" srcdoc="<textarea id=t></textarea>"></iframe>';

test('su Mac Cmd+← torna indietro e Cmd+→ avanti, fuori da un campo di testo', async ({ app, openTab, testServer }) => {
  const { page, urlA, urlB } = await scheda_con_A_e_B({ openTab, testServer });
  await diventaMac(app);

  await page.locator('#mark-b').click();
  await premiNellaPagina(app, 'Left', ['meta']);
  await page.waitForURL(urlA, { timeout: 8_000 });
  await expect(page.locator('#mark-a')).toBeVisible();

  await premiNellaPagina(app, 'Right', ['meta']);
  await page.waitForURL(urlB, { timeout: 8_000 });
  await expect(page.locator('#mark-b')).toBeVisible();

  // Anche col fuoco sulla barra di Filo.
  await premiSullaBarra(app, 'Left', ['meta']);
  await page.waitForURL(urlA, { timeout: 8_000 });
});

test('su Mac Cmd+← dentro un campo di testo non porta via la pagina', async ({ app, openTab, testServer }) => {
  const urlA = testServer.html(PAGE_A);
  const urlC = testServer.html(PAGE_C);
  const page = await testServer.openReady(openTab, PAGE_A);
  await navigateAndReady(page, urlA);
  await navigateAndReady(page, urlC);
  await diventaMac(app);

  const box = page.locator('#box');
  await box.click();
  await box.fill('sto scrivendo');
  await premiNellaPagina(app, 'Left', ['meta']);
  await page.waitForTimeout(1_000);
  expect(page.url()).toBe(urlC);
  await expect(box).toHaveValue('sto scrivendo');

  // Il campo dentro un riquadro è un campo di testo tanto quanto (#405).
  const t = page.frameLocator('#fr').locator('#t');
  await t.click();
  await t.fill('anche qui');
  await premiNellaPagina(app, 'Left', ['meta']);
  await page.waitForTimeout(1_000);
  expect(page.url()).toBe(urlC);
  await expect(t).toHaveValue('anche qui');

  // Uscito dal campo, lo stesso tasto torna indietro.
  await page.locator('#mark-c').click();
  await premiNellaPagina(app, 'Left', ['meta']);
  await page.waitForURL(urlA, { timeout: 8_000 });
});

test('su Mac Cmd+[ naviga anche mentre si scrive, e su Windows Ctrl+← resta alla pagina', async ({ app, openTab, testServer }) => {
  const { page, urlA, urlB } = await scheda_con_A_e_B({ openTab, testServer });

  // Windows (il sistema di chi fa girare la prova qui è Linux: stesso lato).
  await page.locator('#mark-b').click();
  await premiNellaPagina(app, 'Left', ['control']);
  await page.waitForTimeout(800);
  expect(page.url()).toBe(urlB);

  await diventaMac(app);
  const box = page.locator('#box');
  await box.click();
  await box.fill('sto scrivendo');
  await premiNellaPagina(app, '[', ['meta']);
  await page.waitForURL(urlA, { timeout: 8_000 });
});

// ── Cmd+freccia è prima della pagina (#685.1 giro 1) ────────────────────────
// Come in Safari e Chrome: si naviga solo se la pagina non l'ha usata e non ci si
// scrive. Le tre strade per cui prima Filo indovinava male e portava via la pagina.

async function schedaSu(app, { openTab, testServer }, html) {
  const urlA = testServer.html(PAGE_A);
  const url = testServer.html(html);
  const page = await testServer.openReady(openTab, PAGE_A);
  await navigateAndReady(page, urlA);
  await navigateAndReady(page, url);
  await diventaMac(app);
  return { page, url, urlA };
}

// Come gli editor di documenti online: il testo si disegna nella pagina, i tasti
// li riceve un campo in un riquadro, e un clic sul foglio non toglie il fuoco al campo.
const PAGE_DOC = '<!doctype html><title>Doc</title>'
  + '<div id="foglio" style="height:200px;background:#eee">foglio</div>'
  + '<iframe id="fr" srcdoc="<div id=ed contenteditable=true style=min-height:40px></div>"></iframe>'
  + '<script>document.getElementById("foglio").addEventListener("mousedown", e => e.preventDefault());</script>';

test('su Mac Cmd+← in un editor dentro un riquadro, dopo un clic sul foglio, non porta via la pagina', async ({ app, openTab, testServer }) => {
  const { page, url } = await schedaSu(app, { openTab, testServer }, PAGE_DOC);
  const ed = page.frameLocator('#fr').locator('#ed');
  await ed.click();
  await page.keyboard.type('una riga scritta');
  await page.waitForTimeout(700);
  await page.locator('#foglio').click();
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('fr');
  await premiNellaPagina(app, 'Left', ['meta']);
  await page.waitForTimeout(1_200);
  expect(page.url()).toBe(url);
  await expect(ed).toHaveText('una riga scritta');
});

test('su Mac Cmd+← in un campo «solo testo» non porta via la pagina', async ({ app, openTab, testServer }) => {
  const { page, url } = await schedaSu(app, { openTab, testServer },
    '<!doctype html><title>T</title><div id="ed" contenteditable="plaintext-only" style="min-height:40px"></div>');
  await page.locator('#ed').click();
  await page.keyboard.type('testo');
  await premiNellaPagina(app, 'Left', ['meta']);
  await page.waitForTimeout(1_200);
  expect(page.url()).toBe(url);
});

// Un componente web a shadow DOM chiuso (widget di chat, di pagamento) nasconde il suo campo alla pagina.
const COMPONENTE_CHIUSO = '<!doctype html><title>C</title><x-campo id="c"></x-campo><x-tasto id="t"></x-tasto><script>'
  + 'customElements.define("x-campo", class extends HTMLElement { constructor() { super();'
  + ' this.attachShadow({ mode: "closed" }).innerHTML = "<input style=width:300px>"; } });'
  + 'customElements.define("x-tasto", class extends HTMLElement { constructor() { super();'
  + ' this.attachShadow({ mode: "closed" }).innerHTML = "<button>ok</button>"; } });</script>';

test('su Mac Cmd+← in un campo dentro un componente chiuso non porta via la pagina; sul pulsante di un altro componente sì', async ({ app, openTab, testServer }) => {
  const { page, url } = await schedaSu(app, { openTab, testServer }, COMPONENTE_CHIUSO);
  await page.locator('#c').click();
  await page.keyboard.type('scrivo qui');
  await premiNellaPagina(app, 'Left', ['meta']);
  await page.waitForTimeout(1_200);
  expect(page.url()).toBe(url);

  await page.locator('#t').click();
  await premiNellaPagina(app, 'Left', ['meta']);
  await expect.poll(() => page.url(), { timeout: 8_000 }).not.toBe(url);
});

test('su Mac una pagina che usa Cmd+← per sé la tiene, e la scheda resta lì', async ({ app, openTab, testServer }) => {
  const { page, url } = await schedaSu(app, { openTab, testServer },
    '<!doctype html><title>P</title><h1 id="p">griglia</h1><div id="n">0</div>'
    + '<script>addEventListener("keydown", e => { if (e.metaKey && e.key === "ArrowLeft") { e.preventDefault(); n.textContent = +n.textContent + 1; } });</script>');
  await page.locator('#p').click();
  await premiNellaPagina(app, 'Left', ['meta']);
  await expect(page.locator('#n')).toHaveText('1');
  await page.waitForTimeout(1_200);
  expect(page.url()).toBe(url);
});

test('su Mac Cmd+← vale anche sulle pagine di Filo', async ({ app, openTab }) => {
  const page = await openTab('filo://history/history.html');
  await page.waitForLoadState('domcontentloaded');
  const partenza = page.url();
  await page.evaluate(() => { window.location.href = 'filo://options/options.html'; });
  await page.waitForURL(/filo:\/\/options\//, { timeout: 10_000 });
  await page.waitForLoadState('domcontentloaded');
  await diventaMac(app);
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await premiNellaPagina(app, 'Left', ['meta']);
  await page.waitForURL(partenza, { timeout: 8_000 });
});
