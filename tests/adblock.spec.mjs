// Motore di ad-blocking per-dominio basato su liste (src/main/services/adblock.js).
// I test asseriscono il COMPORTAMENTO: una richiesta verso un dominio presente
// nelle liste viene ANNULLATA a monte (net::ERR_BLOCKED_BY_CLIENT), mentre una
// verso un dominio non in lista NON viene annullata. Controprova: col toggle
// spento, anche il dominio in lista passa.
//
// Come nel test del blocco tracker (cookies.spec.mjs) usiamo onErrorOccurred,
// che scatta PRIMA di qualsiasi I/O di rete: il segnale è deterministico e non
// dipende dalla connettività. Le liste si iniettano via setDomainsForTest, così
// il test non scarica nulla dalla rete.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

// Domini finti, non risolvibili: se NON bloccati, una richiesta fallisce per
// motivi di rete (DNS), mai per blocco client — esattamente ciò che vogliamo
// distinguere.
const BLOCKED = 'ads.filo-adblock-test.example';
const ALLOWED = 'cdn.filo-allowed-test.example';

// Inietta la lista di blocco e imposta lo stato del toggle nel main.
async function configureAdblock(app, { enabled, domains }) {
  await app.evaluate(({ }, args) => {
    const A = globalThis.__filoAdblock;
    A.setDomainsForTest(args.domains);
    A.configureFromSettings({ security: { adblock: { enabled: args.enabled } } });
  }, { enabled, domains });
}

// Arma un osservatore sugli errori di rete verso un host specifico PRIMA di
// scatenare la richiesta.
async function armObserver(app, host) {
  await app.evaluate(({ session }, h) => {
    globalThis.__filoAdblockErr = null;
    session.defaultSession.webRequest.onErrorOccurred(
      { urls: [`*://*.${h}/*`, `*://${h}/*`] },
      (details) => { if (globalThis.__filoAdblockErr === null) globalThis.__filoAdblockErr = details.error; },
    );
  }, host);
}

async function fireRequest(page, host) {
  await page.evaluate((h) => {
    const img = new Image();
    img.src = `https://${h}/pixel.gif?t=` + Date.now();
    document.body.appendChild(img);
  }, host);
}

async function waitErr(app) {
  return app.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      if (globalThis.__filoAdblockErr) return globalThis.__filoAdblockErr;
      await new Promise((r) => setTimeout(r, 50));
    }
    return globalThis.__filoAdblockErr;
  });
}

test('blocco attivo: la richiesta a un dominio in lista viene annullata', async ({ app, openTab, testServer }) => {
  await configureAdblock(app, { enabled: true, domains: [BLOCKED] });
  await armObserver(app, BLOCKED);
  const page = await testServer.openReady(openTab, '<title>ADBLK</title><p>ok</p>');
  await fireRequest(page, BLOCKED);
  const err = await waitErr(app);
  expect(err).toBe('net::ERR_BLOCKED_BY_CLIENT');
});

test('blocco attivo: un dominio NON in lista passa (controprova)', async ({ app, openTab, testServer }) => {
  await configureAdblock(app, { enabled: true, domains: [BLOCKED] });
  await armObserver(app, ALLOWED);
  const page = await testServer.openReady(openTab, '<title>ADBLK_OK</title><p>ok</p>');
  await fireRequest(page, ALLOWED);
  const err = await waitErr(app);
  // Non in lista → va in rete: o successo, o errore di rete (DNS), MAI blocco client.
  expect(err).not.toBe('net::ERR_BLOCKED_BY_CLIENT');
});

test('toggle spento: anche il dominio in lista passa (controprova)', async ({ app, openTab, testServer }) => {
  await configureAdblock(app, { enabled: false, domains: [BLOCKED] });
  await armObserver(app, BLOCKED);
  const page = await testServer.openReady(openTab, '<title>ADBLK_OFF</title><p>ok</p>');
  await fireRequest(page, BLOCKED);
  const err = await waitErr(app);
  expect(err).not.toBe('net::ERR_BLOCKED_BY_CLIENT');
});

test('la pagina Sicurezza riflette e salva il toggle ad-blocking', async ({ openTab }) => {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#sec-adblock', { timeout: 8_000 });
  // Default-on: la checkbox parte spuntata.
  expect(await sec.locator('#sec-adblock').isChecked()).toBe(true);
  // Disattivo → auto-save (hint "salvato").
  await sec.locator('#sec-adblock').uncheck();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  // Ricaricando, lo stato disattivato persiste.
  const sec2 = await openTab('filo://security/');
  await sec2.waitForSelector('#sec-adblock', { timeout: 8_000 });
  expect(await sec2.locator('#sec-adblock').isChecked()).toBe(false);
});

test('whitelist di base: un dominio legittimo non si blocca anche se in lista', async ({ app }) => {
  const res = await app.evaluate(() => {
    const A = globalThis.__filoAdblock;
    A.setDomainsForTest(['google.com', 'ads.evil.test']);
    return {
      google: A.isBlockedHost('google.com'),
      mailGoogle: A.isBlockedHost('mail.google.com'),
      evil: A.isBlockedHost('ads.evil.test'),
    };
  });
  expect(res.google).toBe(false);
  expect(res.mailGoogle).toBe(false);
  expect(res.evil).toBe(true);
});

// #576 — la pubblicità che il sito serve da sé, o il riquadro che resta vuoto dopo il blocco di rete: le regole
// di occultamento delle liste la tolgono dalla pagina, anche quando il sito la vuole visibile con !important.
const REGOLE = [
  'sito-pubblico.test###banner_top',
  'sito-pubblico.test##a[href^="/partner/"]',
  'sito-pubblico.test#?#.blockSearch:has(.adsbygoogle)',
  '##.ad-slot',
  '##div[id^="div-gpt-ad"]',
].join('\n');

// Col doctype, come i siti veri: in modalità quirks Chromium non applica ai fogli iniettati le classi con maiuscole.
const PAGINA_CON_PUBBLICITA = `<!doctype html><title>PUB</title>
<style>#banner_top{display:block!important;height:90px;background:#c00}</style>
<div id="banner_top">PUBBLICITÀ in alto</div>
<div class="ad-slot">pubblicità generica</div>
<div id="div-gpt-ad-123">slot vuoto</div>
<a href="/partner/netflix">Guarda su un partner</a>
<div class="blockSearch"><ins class="adsbygoogle">annuncio</ins></div>
<main id="contenuto"><h1>Pantheon S01E02</h1><a href="/episodi">Episodi</a></main>
<script>
  setTimeout(() => {
    const d = document.createElement('div');
    d.id = 'tardiva';
    d.className = 'ad-slot';
    d.textContent = 'pubblicità arrivata dopo';
    document.body.appendChild(d);
  }, 400);
</script>`;

async function regoleOcculta(app, enabled) {
  await app.evaluate(({}, args) => {
    const A = globalThis.__filoAdblock;
    A.setCosmeticForTest(args.regole);
    A.configureFromSettings({ security: { adblock: { enabled: args.enabled } } });
  }, { regole: REGOLE, enabled });
}

function visibili(page) {
  return page.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel);
      return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    };
    return {
      bannerTop: vis('#banner_top'),
      adSlot: vis('.ad-slot'),
      gpt: vis('#div-gpt-ad-123'),
      partner: vis('a[href^="/partner/"]'),
      blockSearch: vis('.blockSearch'),
      tardiva: vis('#tardiva'),
      contenuto: vis('#contenuto'),
      episodi: vis('a[href="/episodi"]'),
    };
  });
}

test('i riquadri della pubblicità spariscono dalla pagina, il contenuto resta (#576)', async ({ app, openTab, testServer }) => {
  await regoleOcculta(app, true);
  const page = await testServer.openReady(openTab, PAGINA_CON_PUBBLICITA, { pubblico: true });
  await page.waitForSelector('#tardiva', { state: 'attached', timeout: 5_000 });
  await expect.poll(() => visibili(page), { timeout: 5_000 }).toEqual({
    bannerTop: false,
    adSlot: false,
    gpt: false,
    partner: false,
    blockSearch: false,
    tardiva: false,
    contenuto: true,
    episodi: true,
  });
});

test('col blocco della pubblicità spento i riquadri restano dove il sito li mette (controprova)', async ({ app, openTab, testServer }) => {
  await regoleOcculta(app, false);
  const page = await testServer.openReady(openTab, PAGINA_CON_PUBBLICITA, { pubblico: true });
  await page.waitForSelector('#tardiva', { state: 'attached', timeout: 5_000 });
  const v = await visibili(page);
  expect(Object.values(v).every(Boolean), JSON.stringify(v)).toBe(true);
});

test('una pagina che vieta gli stili esterni perde lo stesso i suoi riquadri pubblicitari', async ({ app, openTab, testServer }) => {
  await regoleOcculta(app, true);
  const page = await testServer.openReady(openTab, `<!doctype html><title>PUB_CSP</title>
<meta http-equiv="Content-Security-Policy" content="style-src 'none'">
<div class="ad-slot">pubblicità</div><p id="testo">testo</p>`, { pubblico: true });
  await expect.poll(() => page.evaluate(() => ({
    pub: getComputedStyle(document.querySelector('.ad-slot')).display,
    testo: getComputedStyle(document.querySelector('#testo')).display,
  })), { timeout: 5_000 }).toEqual({ pub: 'none', testo: 'block' });
});

test('anche nella finestra incognito la pubblicità in lista non si carica (#576)', async ({ app, shell, testServer }) => {
  await configureAdblock(app, { enabled: true, domains: [BLOCKED] });
  await shell.evaluate(() => window.filoShell.openIncognito());
  const schede = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return w && w._filoTabs ? w._filoTabs.tabs.length : 0;
  });
  await expect.poll(schede, { timeout: 15_000 }).toBe(1);
  const url = testServer.html('<!doctype html><title>ADBLK_INCOGNITO</title><p>ok</p>');
  await app.evaluate(({ BrowserWindow, session }, args) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    globalThis.__filoAdblockErr = null;
    session.fromPartition(w._filoTabs.partition).webRequest.onErrorOccurred(
      { urls: [`*://${args.host}/*`] },
      (d) => { if (globalThis.__filoAdblockErr === null) globalThis.__filoAdblockErr = d.error; },
    );
    w._filoTabs.openTab(args.url);
  }, { url, host: BLOCKED });
  let page = null;
  await expect.poll(async () => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } }) || null;
    return page ? page.evaluate(() => document.readyState === 'complete').catch(() => false) : false;
  }, { timeout: 10_000 }).toBe(true);
  await fireRequest(page, BLOCKED);
  expect(await waitErr(app)).toBe('net::ERR_BLOCKED_BY_CLIENT');
});

// Un annuncio fuori dai contenitori che le liste conoscono: bloccato in rete, non deve lasciare il suo buco in pagina.
test('immagine e riquadro di un server pubblicitario bloccato si chiudono, il testo resta', async ({ app, openTab, testServer }) => {
  await configureAdblock(app, { enabled: true, domains: ['blocked.test'] });
  const adUrl = testServer.html('<!doctype html><body style="background:#c00">ANNUNCIO</body>').replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, `<!doctype html><title>PUB_BUCO</title>
<h1>Pantheon S01E02</h1>
<iframe id="pub" src="${adUrl}" width="728" height="90"></iframe>
<a href="/partner"><img id="img" src="${adUrl.replace(/\/\d+$/, '/banner.gif')}" width="300" height="250"></a>
<p id="testo">testo dopo</p>
<script>setTimeout(() => { const i = new Image(300, 250); i.id = 'tarda'; i.src = '${adUrl.replace(/\/\d+$/, '/tarda.gif')}'; document.body.appendChild(i); }, 300);</script>`, { pubblico: true });
  await page.waitForSelector('#tarda', { state: 'attached', timeout: 5_000 });
  const altezze = () => page.evaluate(() => ({
    riquadro: document.getElementById('pub').getBoundingClientRect().height,
    immagine: document.getElementById('img').getBoundingClientRect().height,
    tarda: document.getElementById('tarda').getBoundingClientRect().height,
    testo: document.getElementById('testo').getBoundingClientRect().height > 0,
  }));
  await expect.poll(altezze, { timeout: 5_000 }).toEqual({ riquadro: 0, immagine: 0, tarda: 0, testo: true });
});

test('spento il blocco dalla pagina Sicurezza, le pagine aperte rimostrano i riquadri; riacceso, li tolgono di nuovo', async ({ app, openTab, testServer }) => {
  await regoleOcculta(app, true);
  const html = (t) => `<!doctype html><title>${t}</title><style>.ad-slot{display:block!important}</style><div class="ad-slot">riquadro</div><p id="t">testo</p>`;
  const prima = await testServer.openReady(openTab, html('PUB_LIVE_1'), { pubblico: true });
  const disp = (p) => () => p.evaluate(() => getComputedStyle(document.querySelector('.ad-slot')).display);
  await expect.poll(disp(prima), { timeout: 5_000 }).toBe('none');
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#sec-adblock', { timeout: 8_000 });
  await sec.locator('#sec-adblock').uncheck();
  await expect.poll(disp(prima), { timeout: 5_000 }).toBe('block');
  // Aperta a blocco spento: nessuna regola in pagina finché non si riaccende.
  const dopo = await testServer.openReady(openTab, html('PUB_LIVE_2'), { pubblico: true });
  expect(await disp(dopo)()).toBe('block');
  await sec.bringToFront();
  await sec.locator('#sec-adblock').check();
  await expect.poll(disp(prima), { timeout: 5_000 }).toBe('none');
  await expect.poll(disp(dopo), { timeout: 5_000 }).toBe('none');
  expect(await prima.evaluate(() => getComputedStyle(document.getElementById('t')).display)).toBe('block');
});

// Annunci fermati per strade indirette: rinvio da un server non in lista, riquadro mandato altrove da uno script,
// immagine dentro un riquadro scritto dalla pagina o servito da un altro server. Il buco deve chiudersi lo stesso.
test('gli annunci fermati per strade indirette non lasciano il buco; un riquadro vero col suo pixel bloccato resta', async ({ app, openTab, testServer }) => {
  await configureAdblock(app, { enabled: true, domains: ['blocked.test'] });
  const rinvii = createServer((req, res) => {
    res.writeHead(302, { Location: `http://blocked.test:${rinvii.address().port}/creativo.gif` });
    res.end();
  });
  await new Promise((r) => rinvii.listen(0, '127.0.0.1', r));
  try {
    const ad = testServer.origin.replace('127.0.0.1', 'blocked.test');
    const altrui = testServer.html(`<!doctype html><body style="margin:0"><img src="${ad}/dentro.gif" width="300" height="250"></body>`);
    const vero = testServer.html(`<!doctype html><body><p>Commenti dei lettori</p><img src="${ad}/pixel.gif" width="1" height="1"></body>`);
    const scritto = JSON.stringify(`<body style="margin:0"><img src="${ad}/w.gif" width="300" height="250"></body>`);
    const page = await testServer.openReady(openTab, `<!doctype html><title>PUB_INDIRETTA</title>
<a href="/partner"><img id="rinvio" src="http://127.0.0.1:${rinvii.address().port}/click?x=1" width="300" height="250"></a>
<iframe id="mandato" width="300" height="250"></iframe>
<iframe id="scritto" width="300" height="250"></iframe>
<iframe id="altrui" src="${altrui}" width="300" height="250"></iframe>
<iframe id="vero" src="${vero}" width="300" height="250"></iframe>
<p id="testo">testo</p>
<script>{ const d = document.getElementById('scritto').contentDocument; d.open(); d.write(${scritto}); d.close(); }
setTimeout(() => { document.getElementById('mandato').contentWindow.location.href = '${ad}/nav.html'; }, 100);</script>`, { pubblico: true });
    const pieni = () => page.evaluate(() => Object.fromEntries(
      ['rinvio', 'mandato', 'scritto', 'altrui', 'vero', 'testo'].map((id) => [id, document.getElementById(id).getBoundingClientRect().height > 0]),
    ));
    await expect.poll(pieni, { timeout: 6_000 }).toEqual({ rinvio: false, mandato: false, scritto: false, altrui: false, vero: true, testo: true });
    // Spento il blocco, i riquadri tornano come il sito li ha messi.
    await app.evaluate(() => globalThis.__filoAdblock.configureFromSettings({ security: { adblock: { enabled: false } } }));
    await expect.poll(pieni, { timeout: 6_000 }).toEqual({ rinvio: true, mandato: true, scritto: true, altrui: true, vero: true, testo: true });
  } finally {
    rinvii.close();
  }
});
