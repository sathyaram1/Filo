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
