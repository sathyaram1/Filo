// #1307 — il tasto destro su un link legge titolo e descrizione della pagina solo per i link puliti: un link sospetto o
// verso un sito della lista dei bloccati non manda nessuna richiesta, e per il bloccato il menu dice che è in lista.
// Le richieste del main ai nomi qui sotto arrivano a un server di prova che le conta; il modello è finto e ripete il titolo.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const TITOLO = 'TITOLO-ANTEPRIMA-1307';
const SENZA = 'Spiegazione senza anteprima';
const HOSTS = ['notizie-pulite.test', 'rinvio-pulito.test', 'sito-bloccato.test', 'paypa1.com', 'paypal.com.accesso-sicuro.net'];

async function serverCheConta() {
  const arrivate = [];
  const server = createServer((req, res) => {
    arrivate.push(req.url);
    if (req.url.startsWith('/rinvio-pulito.test/')) {
      res.writeHead(302, { Location: 'https://sito-bloccato.test/pagina' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>${TITOLO}</title><meta property="og:description" content="Un articolo di prova"></head><body>ok</body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { arrivate, port: server.address().port, chiudi: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

// Il main crede che questi nomi stiano su internet e li raggiunge al server di prova; il modello finto risponde col
// titolo se gli è arrivato, e tiene le richieste per chi controlla.
async function preparaMain(app, port) {
  await app.evaluate(async (_e, { port: p, hosts, TITOLO: titolo, SENZA: senza }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_LINK]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    // L'anteprima esce dalla rete della scheda (#1272): si fingono il risolutore della sessione e il passo di rete.
    const rq = process.mainModule.require;
    const dns = process.getBuiltinModule('dns');
    const lookup = dns.promises.lookup;
    dns.promises.lookup = async (h, o) => (hosts.includes(h) ? [{ address: '93.184.216.34', family: 4 }] : lookup.call(dns.promises, h, o));
    const proto = Object.getPrototypeOf(rq('electron').session.defaultSession);
    const resolveHost = proto.resolveHost;
    proto.resolveHost = function (h, o) {
      return hosts.includes(h) ? Promise.resolve({ endpoints: [{ address: '93.184.216.34', family: 'ipv4' }] }) : resolveHost.call(this, h, o);
    };
    const dip = rq(rq('node:path').join(process.cwd(), 'src/main/services/perContoDellaScheda.js'))._dip;
    const richiesta = dip.richiesta;
    dip.richiesta = (ses, url, o) => {
      let u = null;
      try { u = new URL(String(url)); } catch (_) {}
      if (u && hosts.includes(u.hostname)) return richiesta(ses, `http://127.0.0.1:${p}/${u.hostname}${u.pathname}${u.search}`, o);
      return richiesta(ses, url, o);
    };
    globalThis.__chieste1307 = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ messages, onDelta }) => {
      const t = JSON.stringify(messages);
      globalThis.__chieste1307.push(t);
      const text = t.includes(titolo) ? `Un articolo: ${titolo}` : senza;
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {}, finishReason: 'stop' };
    };
  }, { port, hosts: HOSTS, TITOLO, SENZA });
}

async function lista(shell, blacklist) {
  await shell.evaluate((l) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: l } } },
  }), blacklist);
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
}

const paginaCon = (href) => `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <p><a id="lnk" href="${href}">Leggi qui</a></p></body></html>`;

async function sezioneDelLink(page) {
  await page.locator('#lnk').click({ button: 'right' });
  const sezione = menuDi(page).locator('.sn-menu .sn-menu-inline[data-subject="link"]');
  await expect(sezione).toBeVisible();
  return sezione;
}

let rete;
test.beforeEach(async () => { rete = await serverCheConta(); });
test.afterEach(async () => { await rete.chiudi(); });

test('un link pulito: Filo legge la pagina e la spiegazione ne usa il titolo', async ({ app, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  const page = await testServer.openReady(openTab, paginaCon('https://notizie-pulite.test/articolo'), { pubblico: true });
  const sezione = await sezioneDelLink(page);
  await expect(sezione.locator('.sn-menu-link-body')).toContainText(TITOLO, { timeout: 8000 });
  expect(rete.arrivate).toEqual(['/notizie-pulite.test/articolo']);
  await expect(sezione.locator('.sn-menu-link-warn')).toHaveCount(0);
});

const SOSPETTI = {
  'imitazione col nome storpiato': 'https://paypa1.com/login',
  'il nome vero davanti a un altro dominio': 'https://paypal.com.accesso-sicuro.net/login',
  'aprirlo farebbe già qualcosa': 'https://notizie-pulite.test/unsubscribe?id=4',
};

for (const [forma, href] of Object.entries(SOSPETTI)) {
  test(`un link sospetto (${forma}): nessuna richiesta al sito, l'avviso e la spiegazione senza anteprima`, async ({ app, openTab, testServer }) => {
    await preparaMain(app, rete.port);
    const page = await testServer.openReady(openTab, paginaCon(href), { pubblico: true });
    const sezione = await sezioneDelLink(page);
    await expect(sezione.locator('.sn-menu-link-warn')).toBeVisible();
    // La spiegazione arriva dopo la decisione del main: quando c'è, la richiesta ci sarebbe già stata.
    await expect(sezione.locator('.sn-menu-link-body')).toHaveText(SENZA, { timeout: 8000 });
    expect(rete.arrivate).toEqual([]);
  });
}

test('un link verso un sito della lista dei bloccati: nessuna richiesta, e il menu dice che è in lista', async ({ app, shell, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  await lista(shell, ['sito-bloccato.test']);
  const page = await testServer.openReady(openTab, paginaCon('https://sito-bloccato.test/pagina'), { pubblico: true });
  const sezione = await sezioneDelLink(page);
  const corpo = sezione.locator('.sn-menu-link-body');
  await expect(corpo).toHaveText(/sito-bloccato\.test.*nella tua lista dei siti bloccati/, { timeout: 8000 });
  await expect(sezione).not.toHaveClass(/sn-menu-inline-loading/);
  await page.waitForTimeout(500);
  expect(rete.arrivate).toEqual([]);
  // Al modello non è andato niente: la frase è di Filo.
  const chieste = await app.evaluate(() => globalThis.__chieste1307.slice());
  expect(chieste.some((t) => t.includes('sito-bloccato.test'))).toBe(false);
  await page.screenshot({ path: 'tests/.shots/1307-link-bloccato.png' });
});

test('un link pulito che rimanda a un sito bloccato: Filo si ferma al rinvio e lo dice', async ({ app, shell, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  await lista(shell, ['sito-bloccato.test']);
  const page = await testServer.openReady(openTab, paginaCon('https://rinvio-pulito.test/vai'), { pubblico: true });
  const sezione = await sezioneDelLink(page);
  await expect(sezione.locator('.sn-menu-link-body')).toHaveText(/sito-bloccato\.test.*nella tua lista dei siti bloccati/, { timeout: 8000 });
  expect(rete.arrivate).toEqual(['/rinvio-pulito.test/vai']);
});

test('un\'immagine che fa da link verso un sito della lista: nessuna richiesta, e sopra la descrizione il menu dice che è in lista', async ({ app, shell, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  await lista(shell, ['sito-bloccato.test']);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <a href="https://sito-bloccato.test/offerta"><img id="banner" src="${PX}" width="320" height="160" style="background:#e07b39" alt="Offerta"></a>
  </body></html>`, { pubblico: true });
  await page.locator('#banner').click({ button: 'right' });
  const sezione = menuDi(page).locator('.sn-menu .sn-menu-inline[data-subject="image"]');
  await expect(sezione.locator('.sn-menu-link-nota')).toHaveText(/sito-bloccato\.test.*nella tua lista dei siti bloccati/, { timeout: 8000 });
  await expect(menuDi(page).voce('Apri in nuova tab')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/1307-immagine-link-bloccato.png' });
  expect(rete.arrivate).toEqual([]);
});

// #725.6 e #725.7 — le altre forme di un collegamento: la zona di una mappa d'immagine e il link di un disegno SVG.
const PX ='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('la zona di una mappa d\'immagine verso un sosia: voci del link e dell\'immagine, e l\'avviso d\'imitazione', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <img id="mappa" src="${PX}" usemap="#offerte" width="320" height="160" style="background:#e07b39" alt="Offerte">
    <map name="offerte"><area shape="rect" coords="0,0,160,160" href="https://paypa1.com/login" alt="Accedi al conto"></map>
  </body></html>`);
  await page.locator('#mappa').click({ button: 'right', position: { x: 40, y: 40 } });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible();
  await expect(menu.voce('Apri in nuova tab')).toBeVisible();
  await expect(menu.superficie.getByRole('button', { name: 'Copia URL', exact: true })).toBeVisible();
  await expect(menu.voce('Copia immagine')).toBeVisible();
  const avviso = menu.locator('.sn-menu .sn-menu-inline[data-subject="link"] .sn-menu-link-warn');
  await expect(avviso).toBeVisible({ timeout: 3000 });
  await expect(avviso).toContainText('paypal.com');
  await expect(avviso).toContainText(/imitazione/);
  await page.screenshot({ path: 'tests/.shots/1307-mappa-immagine.png' });
  await page.keyboard.press('Escape');

  // Fuori dalla zona l'immagine resta solo un'immagine.
  await page.locator('#mappa').click({ button: 'right', position: { x: 260, y: 40 } });
  await expect(menu.voce('Copia immagine')).toBeVisible();
  await expect(menu.voce('Apri in nuova tab')).toHaveCount(0);
});

const SVG = {
  'href': '<a href="https://paypa1.com/login">',
  'xlink:href dei disegni vecchi': '<a xlink:href="https://paypa1.com/login">',
};

for (const [forma, apertura] of Object.entries(SVG)) {
  test(`un link dentro un disegno SVG (${forma}) verso un sosia: avviso d'imitazione e indirizzo vero`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="320" height="120">
        ${apertura}<rect id="disegno" width="320" height="120" fill="#e07b39"/><text x="20" y="64">PayPal</text></a>
      </svg></body></html>`);
    await page.locator('#disegno').click({ button: 'right', position: { x: 200, y: 30 } });
    const menu = menuDi(page);
    const avviso = menu.locator('.sn-menu .sn-menu-inline[data-subject="link"] .sn-menu-link-warn');
    await expect(avviso).toBeVisible({ timeout: 3000 });
    await expect(avviso).toContainText('paypal.com');
    await expect(avviso).toContainText(/imitazione/);
    await expect(avviso).not.toContainText(/non è un indirizzo valido/);
    if (forma === 'href') await page.screenshot({ path: 'tests/.shots/1307-link-svg.png' });

    await app.evaluate(({ clipboard }) => clipboard.writeText('vuoto'));
    await menu.voce('Copia URL').click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://paypa1.com/login');
  });
}
