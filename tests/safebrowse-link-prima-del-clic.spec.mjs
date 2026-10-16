// #965 — I link di una pagina passano dai controlli locali dei siti pericolosi appena compaiono: al clic su un link da
// avviso l'avviso compare subito, sulla pagina da cui parte, e il sito non si apre finché l'utente non conferma.
// Prima del clic non esce niente: né verso i link né verso Google, i registri, il modello o la finestra isolata.

import { test, expect } from './fixtures/electron.mjs';
import { vistaAvviso, copertura, scriviDallaTastiera, COPERTA } from './helpers/avvisoSito.mjs';

const MODULO = '<title>Accedi</title><form><input name="email" placeholder="Email">'
  + '<input type="password" id="pw" name="pw" placeholder="Password"><button>Accedi</button></form>';

// Ogni richiesta della sessione passa di qui e si conta; i siti finti si servono, il resto (il mini server) prosegue.
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
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
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
      const v = t._sbLink && t._sbLink.get(u);
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

// Il clic su un link fermato prima di aprirsi non avvia nessuna navigazione da aspettare.
const clicFermato = (pagina, sel, opz = {}) => pagina.click(sel, { ...opz, noWaitAfter: true });

// Le analisi in volo finite e il verdetto della pagina chiesto di nuovo: un avviso che dovesse tornare, è tornato.
async function verdettiFiniti(app) {
  await app.evaluate(async () => { await globalThis.SN_SAFEBROWSE._settled(); });
}

test('link a un\'imitazione di marchio: verdetto pronto senza rete, al clic l\'avviso compare e il sito non si apre', async ({ app, openTab, testServer }) => {
  await contaLaRete(app, { 'paypa1.com/login': MODULO });
  const pagina = await testServer.openReady(openTab, '<title>Forum</title><p>Ciao, entra qui: '
    + '<a id="truffa" href="https://paypa1.com/login">Accedi a PayPal</a> oppure '
    + '<a id="vera" href="https://www.wikipedia.org/wiki/PayPal">leggi di PayPal</a></p>');
  await fuocoAllaPagina(app);
  const forum = pagina.url();

  await expect.poll(() => verdettoPronto(app, 'https://paypa1.com/login')).toBe('pericoloso');
  expect(await verdettoPronto(app, 'https://www.wikipedia.org/wiki/PayPal')).toBe(null);
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);
  expect(await richiesteVerso(app, 'wikipedia.org')).toEqual([]);
  expect(await fornitori(app)).toEqual([]);

  await clicFermato(pagina, '#truffa');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  await expect(avviso.getByText(/Il dominio è paypa1\.com/)).toBeVisible();
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  await expect(avviso.getByRole('button', { name: 'Procedi comunque' })).toBeDisabled();
  expect(pagina.url()).toBe(forum);
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);

  // «Non aprire»: l'avviso va via, si resta sulla pagina e il sito non è mai stato chiesto.
  await avviso.getByRole('button', { name: 'Non aprire' }).click();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  await expect.poll(async () => (await copertura(app)).tastiera).toBe('pagina');
  expect(pagina.url()).toBe(forum);
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);

  // Di nuovo, e stavolta «confermo»: il sito si apre nella stessa scheda, e l'avviso non si ripete a pagina aperta.
  await clicFermato(pagina, '#truffa');
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
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

  await clicFermato(pagina, '#simile');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('PayPal? Controlla l\'indirizzo')).toBeVisible();
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
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
  await clicFermato(pagina, '#truffa', { modifiers: ['ControlOrMeta'] });
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  await avviso.getByRole('button', { name: 'Non aprire' }).click();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  expect(await schedeWeb(app)).toEqual([forum]);
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);
});

test('un link a un file travestito: l\'avviso nomina il file prima che parta', async ({ app, openTab, testServer }) => {
  await contaLaRete(app, {});
  const pagina = await testServer.openReady(openTab, '<title>Posta</title>'
    + '<a id="file" href="https://archivio-documenti.example.com/fattura.pdf.exe">la tua fattura</a>');
  await fuocoAllaPagina(app);
  await expect.poll(() => verdettoPronto(app, 'https://archivio-documenti.example.com/fattura.pdf.exe')).toBe('sospetto');
  await clicFermato(pagina, '#file');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('File travestito')).toBeVisible();
  await expect(avviso.getByText(/«fattura\.pdf\.exe»: sembra un documento, ma è un programma/)).toBeVisible();
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
  await clicFermato(pagina, '#nuovo');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);
});

test('una pagina con 5.000 link resta reattiva: esame a lotti, prima i link a schermo, nessuna richiesta di rete', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await contaLaRete(app, {});
  const N = 5000;
  // In colonna rovesciata il primo link della pagina sta in fondo, fuori schermo, e l'ultimo in cima.
  const righe = [];
  for (let i = 0; i < N - 2; i++) righe.push(`<a href="https://risultato-${i}.esempio-${i % 997}.com/pagina/${i}">risultato ${i}</a>`);
  const html = '<title>Risultati</title><style>#lista{display:flex;flex-direction:column-reverse}</style><div id="lista">'
    + '<a id="giu" href="https://paypa1.com/in-fondo">in fondo</a>' + righe.join('')
    + '<a id="su" href="https://paypal-login.com/in-cima">in cima</a></div>';

  // Il main misura i suoi buchi: il tempo più lungo in cui non ha potuto rispondere a nient'altro.
  await app.evaluate(() => {
    globalThis.__buco = { max: 0, attivo: true };
    let prima = performance.now();
    const giro = () => {
      const ora = performance.now();
      globalThis.__buco.max = Math.max(globalThis.__buco.max, ora - prima);
      prima = ora;
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
    return { segnalati: t._sbLink ? [...t._sbLink.keys()] : [], inCoda: t._sbLinkInCoda || 0 };
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
  await pagina.locator('#giu').click({ noWaitAfter: true });
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);
});
