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
