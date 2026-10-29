// #965 — I link di una pagina passano dai controlli locali dei siti pericolosi appena compaiono: al clic su un link da
// avviso l'avviso compare subito, sulla pagina da cui parte, e il sito non si apre finché l'utente non conferma.
// Prima del clic non esce niente: né verso i link né verso Google, i registri, il modello o la finestra isolata.

import { test, expect } from './fixtures/electron.mjs';
import { vistaAvviso, copertura, scriviDallaTastiera, COPERTA } from './helpers/avvisoSito.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

// L'aspetto si guarda: le foto restano in tests/.shots/, fuori dal repo.
async function foto(avviso, nome) {
  await avviso.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  await avviso.screenshot({ path: fileURLToPath(new URL(`./.shots/${nome}`, import.meta.url)) });
}

const MODULO = '<title>Accedi</title><form><input name="email" placeholder="Email">'
  + '<input type="password" id="pw" name="pw" placeholder="Password"><button>Accedi</button></form>';

// Ogni richiesta della sessione passa di qui e si conta; i siti finti si servono, il mini server prosegue, il resto non
// esce: un nome finto (paypa1.com) su internet esiste davvero, e può non rispondere mai (#1456).
// I fornitori di rete del rilevatore sono finti e contano le chiamate.
async function contaLaRete(app, pagine = {}) {
  await app.evaluate(async ({ session, net }, pg) => {
    globalThis.__richieste = [];
    globalThis.__fornitori = [];
    const risposta = (req) => {
      globalThis.__richieste.push(req.url);
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (u.hostname === '127.0.0.1') return net.fetch(req, { bypassCustomProtocolHandlers: true });
      return Response.error();
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    const conta = (nome) => async (x) => { globalThis.__fornitori.push(`${nome}:${typeof x === 'string' ? x : JSON.stringify(x)}`); return null; };
    globalThis.SN_SAFEBROWSE.setProviders({
      gsb: conta('gsb'), gsbPeek: null, rdap: conta('rdap'), ct: conta('ct'), llm: conta('llm'), sandbox: conta('sandbox'),
    });
  }, pagine);
}

// `host`: il nome del sito, o un'espressione sul nome quando i siti sono tanti.
const richiesteVerso = (app, host) => app.evaluate((_, { h, re }) => globalThis.__richieste.filter((u) => {
  try { const n = new URL(u).hostname; return re ? new RegExp(re).test(n) : n === h || n.endsWith('.' + h); } catch (_) { return false; }
}), host instanceof RegExp ? { re: host.source } : { h: host });
const fornitori = (app) => app.evaluate(() => globalThis.__fornitori);

// Il verdetto che il main tiene pronto per un link della scheda che lo mostra (null: non esaminato o pulito).
const verdettoPronto = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      const v = t._sbLinkSegnalati && t._sbLinkSegnalati.get(u);
      if (v) return v.level;
    }
  }
  return null;
}, url);

const schedeWeb = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w._filoTabs.tabs.map((t) => t.view.webContents.getURL()).filter((u) => /^https?:/.test(u));
});

// Chi clicca un link ha la finestra davanti e la pagina sotto le dita: l'avviso che compare prende la tastiera da lì.
const fuocoAllaPagina = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  win.focus();
  win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents.focus();
});

// Il clic come lo dà il mouse, nella scheda attiva. Tutto passa dal main: dopo un collegamento fermato prima di aprirsi
// Playwright resta ad aspettare sulla pagina una navigazione che non arriva, e i suoi locator non si muovono più.
async function clicFermato(app, sel, { modifiers = [] } = {}) {
  const m = modifiers.map((k) => (k === 'ControlOrMeta' ? (process.platform === 'darwin' ? 'meta' : 'control') : k.toLowerCase()));
  await app.evaluate(async ({ BrowserWindow }, { sel: s, m: mod }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const wc = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents;
    const r = await wc.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(s)});
      el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    const p = { x: r.x, y: r.y, button: 'left', clickCount: 1, modifiers: mod };
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    wc.sendInputEvent({ type: 'mouseDown', ...p });
    wc.sendInputEvent({ type: 'mouseUp', ...p });
  }, { sel, m });
}

// L'indirizzo della scheda attiva e un valore della sua pagina, chiesti dal main per la stessa ragione.
const schedaAttiva = (app, codice = 'null') => app.evaluate(async ({ BrowserWindow }, c) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  const wc = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents;
  return { url: wc.getURL(), valore: await wc.executeJavaScript(c) };
}, codice);

// Le analisi in volo finite e il verdetto della pagina chiesto di nuovo: un avviso che dovesse tornare, è tornato.
async function verdettiFiniti(app) {
  await app.evaluate(async () => { await globalThis.SN_SAFEBROWSE._settled(); });
}

test('link a un\'imitazione di marchio: verdetto pronto senza rete, al clic l\'avviso compare e il sito non si apre', async ({ app, openTab, testServer }) => {
  await contaLaRete(app, { 'paypa1.com/login': MODULO });
  const pagina = await testServer.openReady(openTab, '<title>Forum</title><p>Ciao, entra qui: '
    + '<a id="truffa" href="https://paypa1.com/login">Accedi a PayPal</a> oppure '
    + '<a id="vera" href="https://www.wikipedia.org/wiki/PayPal">leggi di PayPal</a></p><input id="nota">');
  await fuocoAllaPagina(app);
  const forum = pagina.url();

  await expect.poll(() => verdettoPronto(app, 'https://paypa1.com/login')).toBe('pericoloso');
  expect(await verdettoPronto(app, 'https://www.wikipedia.org/wiki/PayPal')).toBe(null);
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);
  expect(await richiesteVerso(app, 'wikipedia.org')).toEqual([]);
  expect(await fornitori(app)).toEqual([]);

  await clicFermato(app, '#truffa');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  await expect(avviso.getByText(/Il dominio è paypa1\.com/)).toBeVisible();
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  await foto(avviso, '965-link-pericoloso.png');
  await expect(avviso.getByRole('button', { name: 'Procedi comunque' })).toBeDisabled();
  expect((await schedaAttiva(app)).url).toBe(forum);
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);

  // «Non aprire»: l'avviso va via, si resta sulla pagina e il sito non è mai stato chiesto.
  await avviso.getByRole('button', { name: 'Non aprire' }).click();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  await expect.poll(async () => (await copertura(app)).tastiera).toBe('pagina');
  expect((await schedaAttiva(app)).url).toBe(forum);
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);
  // La pagina resta quella di prima, e risponde: ci si scrive.
  await clicFermato(app, '#nota');
  await scriviDallaTastiera(app, 'resto qui');
  await expect.poll(async () => (await schedaAttiva(app, 'document.querySelector("#nota").value')).valore).toBe('resto qui');

  // Di nuovo, e stavolta «confermo»: il sito si apre nella stessa scheda, e l'avviso non si ripete a pagina aperta.
  await clicFermato(app, '#truffa');
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  await expect(avviso.getByRole('button', { name: 'Procedi comunque' })).toBeDisabled();
  await expect(avviso.getByPlaceholder('confermo')).toBeFocused();
  await scriviDallaTastiera(app, 'confermo');
  await avviso.getByRole('button', { name: 'Procedi comunque' }).click();
  await pagina.waitForURL('https://paypa1.com/login');
  await expect(pagina.locator('#pw')).toBeVisible();
  expect((await richiesteVerso(app, 'paypa1.com')).length).toBeGreaterThan(0);
  await pagina.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await verdettiFiniti(app);
  expect((await copertura(app)).coperta).toBe(false);
  await pagina.locator('#pw').fill('ok');
  await expect(pagina.locator('#pw')).toHaveValue('ok');
});

test('link sospetto che si apre in una scheda nuova: l\'avviso compare sulla pagina, «Continua» apre la scheda senza ripeterlo', async ({ app, openTab, testServer }) => {
  await contaLaRete(app, { 'paypal-login.com/conto': '<title>Conto</title><p>conto</p>' });
  const pagina = await testServer.openReady(openTab, '<title>Notizie</title>'
    + '<a id="simile" target="_blank" href="https://paypal-login.com/conto">il tuo conto</a>');
  await fuocoAllaPagina(app);
  const forum = pagina.url();
  await expect.poll(() => verdettoPronto(app, 'https://paypal-login.com/conto')).toBe('sospetto');

  await clicFermato(app, '#simile');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('PayPal? Controlla l\'indirizzo')).toBeVisible();
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  await foto(avviso, '965-link-sospetto.png');
  expect(await schedeWeb(app)).toEqual([forum]);
  expect(await richiesteVerso(app, 'paypal-login.com')).toEqual([]);

  const continua = avviso.getByRole('button', { name: 'Continua' });
  await expect(continua).toBeEnabled({ timeout: 3_000 });
  await continua.click();
  await expect.poll(() => schedeWeb(app)).toEqual([forum, 'https://paypal-login.com/conto']);
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  await verdettiFiniti(app);
  expect((await copertura(app)).coperta).toBe(false);
  // A sito aperto i controlli di rete partono: i fornitori finti delle altre prove contano davvero.
  expect(await fornitori(app)).not.toEqual([]);
});

test('Ctrl+clic su un link da avviso: l\'avviso compare subito, e «Non aprire» non lascia schede', async ({ app, openTab, testServer }) => {
  await contaLaRete(app, {});
  const pagina = await testServer.openReady(openTab, '<title>Lista</title><a id="truffa" href="https://paypa1.com/premio">premio</a>');
  await fuocoAllaPagina(app);
  const forum = pagina.url();
  await clicFermato(app, '#truffa', { modifiers: ['ControlOrMeta'] });
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  await avviso.getByRole('button', { name: 'Non aprire' }).click();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  expect(await schedeWeb(app)).toEqual([forum]);
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);
});

test('le altre porte dello stesso link: «Apri in nuova tab» dal tasto destro e un pulsante che ci porta da script', async ({ app, openTab, testServer }) => {
  await contaLaRete(app, { 'paypa1.com/premio': '<title>Premio</title><p>premio</p>' });
  const pagina = await testServer.openReady(openTab, '<title>Vetrina</title><p><a id="truffa" href="https://paypa1.com/premio">ritira il premio</a></p>'
    + '<p><button id="vai" onclick="location.href=\'https://paypa1.com/premio\'">Ritira</button></p>');
  await fuocoAllaPagina(app);
  const forum = pagina.url();

  await pagina.locator('#truffa').click({ button: 'right' });
  const menu = menuDi(pagina).pannelli;
  await expect(menu).toBeVisible({ timeout: 20_000 });
  await menu.locator('.sn-menu-item', { hasText: 'nuova tab' }).first().click({ noWaitAfter: true });
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
  expect(await schedeWeb(app)).toEqual([forum]);
  await avviso.getByPlaceholder('confermo').fill('confermo');
  await avviso.getByRole('button', { name: 'Procedi comunque' }).click();
  await expect.poll(() => schedeWeb(app)).toEqual([forum, 'https://paypa1.com/premio']);

  // Torna alla vetrina: il pulsante che porta allo stesso sito da script si ferma uguale (la conferma era dell'altra scheda).
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    tm.activate(tm.tabs.find((t) => t.view.webContents.getURL() === u).id);
  }, forum);
  await fuocoAllaPagina(app);
  await clicFermato(app, '#vai');
  await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  expect((await schedaAttiva(app)).url).toBe(forum);
});

test('un link a un file travestito: l\'avviso nomina il file prima che parta', async ({ app, openTab, testServer }) => {
  await contaLaRete(app, {});
  const pagina = await testServer.openReady(openTab, '<title>Posta</title>'
    + '<a id="file" href="https://archivio-documenti.example.com/fattura.pdf.exe">la tua fattura</a>');
  await fuocoAllaPagina(app);
  await expect.poll(() => verdettoPronto(app, 'https://archivio-documenti.example.com/fattura.pdf.exe')).toBe('sospetto');
  await clicFermato(app, '#file');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('File travestito')).toBeVisible();
  await expect(avviso.getByText(/«fattura\.pdf\.exe»: sembra un documento, ma è un programma/)).toBeVisible();
  await foto(avviso, '965-file-travestito.png');
  expect(await richiesteVerso(app, 'archivio-documenti.example.com')).toEqual([]);
});

test('un link che compare scorrendo ha il verdetto pronto prima del clic, e il clic lo ferma', async ({ app, openTab, testServer }) => {
  await contaLaRete(app, {});
  const pagina = await testServer.openReady(openTab, '<title>Bacheca</title><div style="height:4000px">inizio</div>'
    + '<div id="fondo"></div><script>'
    + 'addEventListener("scroll", function () { if (document.getElementById("nuovo")) return;'
    + ' if (scrollY + innerHeight < document.body.scrollHeight - 50) return;'
    + ' var a = document.createElement("a"); a.id = "nuovo"; a.href = "https://paypa1.com/offerta"; a.textContent = "offerta";'
    + ' document.getElementById("fondo").appendChild(a); });</script>');
  await fuocoAllaPagina(app);
  expect(await verdettoPronto(app, 'https://paypa1.com/offerta')).toBe(null);
  await pagina.mouse.wheel(0, 5000);
  await expect(pagina.locator('#nuovo')).toBeAttached();
  await expect.poll(() => verdettoPronto(app, 'https://paypa1.com/offerta')).toBe('pericoloso');
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);
  await clicFermato(app, '#nuovo');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);
});

test('una pagina con 5.000 link resta reattiva: esame a lotti, prima i link a schermo, nessuna richiesta di rete', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await contaLaRete(app, {});
  const N = 5000;
  // In colonna rovesciata il primo link della pagina sta in fondo, fuori schermo, e l'ultimo in cima. Compaiono tutti
  // insieme: scritti nell'HTML, su una macchina carica arrivano a pezzi e i primi partono quando quello in cima non c'è
  // ancora, e lì nessun ordine è sbagliato (#1792).
  const html = '<title>Risultati</title><style>#lista{display:flex;flex-direction:column-reverse}</style><div id="lista"></div>'
    + `<script>(function () { var h = '<a id="giu" href="https://paypa1.com/in-fondo">in fondo</a>';`
    + ` for (var i = 0; i < ${N - 2}; i++) h += '<a href="https://risultato-' + i + '.esempio-' + (i % 997) + '.com/pagina/' + i + '">risultato ' + i + '</a>';`
    + ` document.getElementById('lista').innerHTML = h + '<a id="su" href="https://paypal-login.com/in-cima">in cima</a>'; })();</script>`;

  // Il main misura i suoi buchi: il tempo più lungo in cui non ha potuto rispondere a nient'altro, con l'esame in corso
  // all'inizio o alla fine del buco. Aprire la scheda ferma il main per conto suo, e su una macchina carica supera il
  // tetto senza che i link c'entrino (#1792).
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__buco = { max: 0, attivo: true };
    const inEsame = () => BrowserWindow.getAllWindows()
      .some((w) => ((w._filoTabs && w._filoTabs.tabs) || []).some((t) => (t._sbLinkInCoda || 0) > 0));
    let prima = performance.now();
    let eraInEsame = inEsame();
    const giro = () => {
      const ora = performance.now();
      const adesso = inEsame();
      if (eraInEsame || adesso) globalThis.__buco.max = Math.max(globalThis.__buco.max, ora - prima);
      prima = ora;
      eraInEsame = adesso;
      if (globalThis.__buco.attivo) setTimeout(giro, 1);
    };
    setTimeout(giro, 1);
  });
  const pagina = await testServer.openReady(openTab, html);
  await fuocoAllaPagina(app);
  // La pagina misura i suoi, da quando è pronta.
  await pagina.evaluate(() => {
    window.__buco = { max: 0, attivo: true };
    let prima = performance.now();
    const giro = () => {
      const ora = performance.now();
      window.__buco.max = Math.max(window.__buco.max, ora - prima);
      prima = ora;
      if (window.__buco.attivo) setTimeout(giro, 1);
    };
    setTimeout(giro, 1);
  });

  const esame = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return { segnalati: t._sbLinkSegnalati ? [...t._sbLinkSegnalati.keys()] : [], inCoda: t._sbLinkInCoda || 0 };
  });
  await expect.poll(async () => (await esame()).segnalati.length, { timeout: 60_000 }).toBe(2);
  await expect.poll(async () => (await esame()).inCoda).toBe(0);
  const buchiMain = await app.evaluate(() => { globalThis.__buco.attivo = false; return globalThis.__buco.max; });
  const buchiPagina = await pagina.evaluate(() => { window.__buco.attivo = false; return window.__buco.max; });

  // Prima il link a schermo, poi quello in fondo, anche se nella pagina viene prima.
  expect((await esame()).segnalati).toEqual(['https://paypal-login.com/in-cima', 'https://paypa1.com/in-fondo']);
  expect(await richiesteVerso(app, /esempio-\d+\.com$|paypa1\.com$|paypal-login\.com$/)).toEqual([]);
  expect(await fornitori(app)).toEqual([]);

  // Il riferimento: lo stesso esame fatto in un colpo solo, su link nuovi della stessa forma. È il buco che l'esame
  // farebbe senza lotti; con i lotti il main e la pagina non restano mai fermi per una parte grossa di quel tempo.
  const unColpo = await app.evaluate(({}, n) => {
    const SB = globalThis.SN_SAFEBROWSE;
    const urls = [];
    for (let i = 0; i < n; i++) urls.push(`https://altro-${i}.prova-${i % 997}.net/pagina/${i}`);
    const t = performance.now();
    SB.links.esaminaLotto(urls, { checkSync: SB.checkSync });
    return performance.now() - t;
  }, N);
  const tetto = unColpo / 4;
  expect(buchiMain, `main fermo al più ${buchiMain.toFixed(1)} ms; in un colpo solo ${unColpo.toFixed(1)} ms`).toBeLessThan(tetto);
  expect(buchiPagina, `pagina ferma al più ${buchiPagina.toFixed(1)} ms; in un colpo solo ${unColpo.toFixed(1)} ms`).toBeLessThan(tetto);

  // E il link in fondo, a esame finito, ferma il clic.
  await clicFermato(app, '#giu');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);
});

// Un sito vero su 127.0.0.1 con le sue strade: serve file e moduli, e conta come gli arrivano le richieste.
async function sitoProprio(pagine) {
  const richieste = [];
  const server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      richieste.push({ metodo: req.method, url: req.url, corpo });
      const path = req.url.split('?')[0];
      if (path.endsWith('.exe') || path.startsWith('/allegato/')) {
        const nome = path.startsWith('/allegato/') ? 'fattura.pdf.exe' : path.split('/').pop();
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': 4, 'Content-Disposition': `attachment; filename="${nome}"` });
        res.end('MZ00');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagine[path] || '<title>Arrivato</title><p id="arrivato">arrivato</p>');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, richieste,
    verso: (inizio) => richieste.filter((r) => r.url.startsWith(inizio)),
    chiudi: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

// Gli scaricamenti che la scheda attiva chiede, col nome e con chi li ha fermati prima che scendessero.
const contaScaricamenti = (app) => app.evaluate(({ BrowserWindow }) => {
  globalThis.__scaricamenti = [];
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const ses = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.session;
  ses.on('will-download', (e, item) => { globalThis.__scaricamenti.push({ nome: item.getFilename(), fermato: e.defaultPrevented }); });
});
const scaricamenti = (app) => app.evaluate(() => globalThis.__scaricamenti);

async function apriSito(openTab, url) {
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

test('un link «scarica» a un file travestito: al clic l\'avviso, il file non parte; «Continua» lo scarica col suo nome', async ({ app, openTab }) => {
  const s = await sitoProprio({
    '/': '<title>Archivio</title><a id="file" download href="/documenti/fattura.pdf.exe">la tua fattura</a>'
      + '<a id="nominato" download="ricevuta.jpg.scr" href="/scarica/42">la ricevuta</a>',
  });
  try {
    await apriSito(openTab, s.origin + '/');
    await fuocoAllaPagina(app);
    await contaScaricamenti(app);
    await clicFermato(app, '#file');
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText(/«fattura\.pdf\.exe»: sembra un documento, ma è un programma/)).toBeVisible();
    await expect.poll(() => copertura(app)).toEqual(COPERTA);
    expect(await scaricamenti(app)).toEqual([]);
    const continua = avviso.getByRole('button', { name: 'Continua' });
    await expect(continua).toBeEnabled({ timeout: 5_000 });
    await continua.click();
    await expect.poll(() => scaricamenti(app)).toEqual([{ nome: 'fattura.pdf.exe', fermato: false }]);
    await expect.poll(async () => (await copertura(app)).coperta).toBe(false);

    // Il nome che conta è quello del file, anche quando l'indirizzo non lo dice. In una scheda nuova: «Continua» vale
    // per il sito nella sua scheda.
    await apriSito(openTab, s.origin + '/');
    await fuocoAllaPagina(app);
    await contaScaricamenti(app);
    await clicFermato(app, '#nominato');
    await expect(avviso.getByText(/«ricevuta\.jpg\.scr»/)).toBeVisible();
    await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
    expect(await scaricamenti(app)).toEqual([]);
  } finally { await s.chiudi(); }
});

test('un file travestito che il sito nomina solo rispondendo: l\'avviso lo ferma prima che scenda', async ({ app, openTab }) => {
  const s = await sitoProprio({ '/': '<title>Posta</title><a id="allegato" href="/allegato/7">apri l\'allegato</a>' });
  try {
    await apriSito(openTab, s.origin + '/');
    await fuocoAllaPagina(app);
    await contaScaricamenti(app);
    await clicFermato(app, '#allegato');
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText(/«fattura\.pdf\.exe»/)).toBeVisible();
    await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
    expect(await scaricamenti(app)).toEqual([{ nome: 'fattura.pdf.exe', fermato: true }]);
  } finally { await s.chiudi(); }
});

// Come gli allegati di una chat o della posta cifrata: il file lo prepara la pagina, e c'è solo il suo nome.
test('un file travestito che la pagina costruisce da sé (blob, data): l\'avviso lo ferma; «Continua» lo scarica col suo nome', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<title>Chat</title><button id="blob">allegato</button><script>'
    + 'document.getElementById("blob").onclick = function () { var a = document.createElement("a");'
    + ' a.href = URL.createObjectURL(new Blob(["MZ00"])); a.download = "fattura.pdf.exe"; document.body.appendChild(a); a.click(); a.remove(); };'
    + '</script>');
  await fuocoAllaPagina(app);
  await contaScaricamenti(app);
  await clicFermato(app, '#blob');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText(/«fattura\.pdf\.exe»: sembra un documento, ma è un programma/)).toBeVisible();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
  expect(await scaricamenti(app)).toEqual([{ nome: 'fattura.pdf.exe', fermato: true }]);
  await expect(avviso.getByRole('button', { name: 'Continua' })).toBeEnabled({ timeout: 5_000 });
  await avviso.getByRole('button', { name: 'Continua' }).click();
  await expect.poll(() => scaricamenti(app)).toEqual([{ nome: 'fattura.pdf.exe', fermato: true }, { nome: 'fattura.pdf.exe', fermato: false }]);
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);

  // Scritto dentro il link: lo stesso, in una scheda nuova (la conferma vale per la sua scheda).
  await testServer.openReady(openTab, '<title>Chat</title><button id="data">allegato</button><script>'
    + 'document.getElementById("data").onclick = function () { var a = document.createElement("a");'
    + ' a.href = "data:application/octet-stream;base64,TVowMA=="; a.download = "fattura.pdf.exe"; document.body.appendChild(a); a.click(); };'
    + '</script>');
  await fuocoAllaPagina(app);
  // La sessione è la stessa: si azzera l'elenco, l'ascoltatore resta quello di prima.
  await app.evaluate(() => { globalThis.__scaricamenti = []; });
  await clicFermato(app, '#data');
  await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
  await expect(avviso.getByText(/«fattura\.pdf\.exe»/)).toBeVisible();
  expect(await scaricamenti(app)).toEqual([{ nome: 'fattura.pdf.exe', fermato: true }]);
});

test('un file travestito su un sito noto (Dropbox, il CDN di Discord): al clic l\'avviso nomina il file', async ({ app, openTab, testServer }) => {
  await contaLaRete(app, {});
  await testServer.openReady(openTab, '<title>Chat</title>'
    + '<a id="dropbox" href="https://www.dropbox.com/s/abc/fattura.pdf.exe">fattura</a>'
    + '<a id="discord" href="https://cdn.discordapp.com/attachments/1/2/foto.jpg.scr">foto</a>');
  await fuocoAllaPagina(app);
  await expect.poll(() => verdettoPronto(app, 'https://cdn.discordapp.com/attachments/1/2/foto.jpg.scr')).toBe('sospetto');
  await clicFermato(app, '#dropbox');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText(/«fattura\.pdf\.exe»: sembra un documento/)).toBeVisible();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
  expect(await richiesteVerso(app, 'dropbox.com')).toEqual([]);
});

test('un modulo verso un indirizzo da avviso: confermato, il sito riceve i dati, nella scheda e in una scheda nuova', async ({ app, openTab }) => {
  const modulo = (id, extra) => `<form id="${id}" method="post" action="/invio/${id}.pdf.exe?x=1" ${extra}>`
    + '<input name="nome" value="Mario"><input name="action" value="campo"><button name="scelta" value="si">Invia</button></form>';
  const s = await sitoProprio({ '/': '<title>Modulo</title>' + modulo('qui', '') + modulo('altrove', 'target="_blank"') });
  try {
    await apriSito(openTab, s.origin + '/');
    await fuocoAllaPagina(app);
    await contaScaricamenti(app);
    await clicFermato(app, '#qui button');
    const avviso = await vistaAvviso(app);
    await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
    expect(s.verso('/invio/')).toEqual([]);
    await expect(avviso.getByRole('button', { name: 'Continua' })).toBeEnabled({ timeout: 5_000 });
    await avviso.getByRole('button', { name: 'Continua' }).click();
    await expect.poll(() => s.verso('/invio/qui').map((r) => `${r.metodo} ${r.corpo}`)).toEqual(['POST nome=Mario&action=campo&scelta=si']);

    await apriSito(openTab, s.origin + '/');
    await fuocoAllaPagina(app);
    await clicFermato(app, '#altrove button');
    await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
    await expect(avviso.getByRole('button', { name: 'Continua' })).toBeEnabled({ timeout: 5_000 });
    await avviso.getByRole('button', { name: 'Continua' }).click();
    await expect.poll(() => s.verso('/invio/altrove').map((r) => `${r.metodo} ${r.corpo}`)).toEqual(['POST nome=Mario&action=campo&scelta=si']);
  } finally { await s.chiudi(); }
});

test('un collegamento aperto da una pagina di Filo o dall\'assistente sopra una pagina: l\'avviso compare prima di aprire', async ({ app, openTab, testServer }) => {
  await contaLaRete(app, { 'paypa1.com/dalla-chat': '<title>Premio</title><p>premio</p>' });
  await openTab('filo://security/');
  await fuocoAllaPagina(app);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.executeJavaScript('window.open("https://paypa1.com/da-filo")');
  });
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
  expect(await schedeWeb(app)).toEqual([]);
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);
  await avviso.getByRole('button', { name: 'Non aprire' }).click();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  expect(await schedeWeb(app)).toEqual([]);

  // Un collegamento in una risposta della chat di Filo, dalla stessa pagina.
  const r = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return globalThis.__filoHandlers.handleMessage(
      { type: globalThis.SN_MSG.MSG.FILO_APRI_PROPOSTA, url: 'https://paypa1.com/dalla-chat', parole: [] },
      { url: t.view.webContents.getURL(), tab: { id: t.id }, wc: t.view.webContents, win: w },
    );
  });
  expect(r.aperto).toBe(true);
  await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  expect(await schedeWeb(app)).toEqual([]);
  await avviso.getByPlaceholder('confermo').fill('confermo');
  await avviso.getByRole('button', { name: 'Procedi comunque' }).click();
  await expect.poll(() => schedeWeb(app)).toEqual(['https://paypa1.com/dalla-chat']);
  await verdettiFiniti(app);
  expect((await copertura(app)).coperta).toBe(false);

  // Il collegamento che l'assistente scrive sopra una pagina web passa dal main: l'avviso compare su quella pagina.
  const pagina = await testServer.openReady(openTab, '<title>Articolo</title><p>testo</p>');
  await fuocoAllaPagina(app);
  const articolo = pagina.url();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.executeJavaScriptInIsolatedWorld(999, [{
      code: 'chrome.runtime.sendMessage({ type: "apri_collegamento_filo", url: "https://paypa1.com/da-assistente" }, () => {})',
    }]);
  });
  await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  expect((await schedeWeb(app)).filter((u) => u.includes('/da-assistente'))).toEqual([]);
  expect((await schedaAttiva(app)).url).toBe(articolo);
  expect((await richiesteVerso(app, 'paypa1.com')).filter((u) => u.includes('/da-assistente'))).toEqual([]);
});
