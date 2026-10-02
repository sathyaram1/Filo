// Giro 1 di main-verde: i moduli dei banner dei cookie girano sulle pagine web e non sulle pagine interne,
// e le pagine interne caricano il resto dei content script senza errori di caricamento.
import { test, expect } from '../../fixtures/electron.mjs';

const INTERNE = ['filo://security/', 'filo://history/', 'filo://options/options.html', 'filo://dashboard/'];

const SOLO_ACCETTA = `<title>SOLO_ACCETTA</title>
  <style>body{margin:0;overflow:hidden} .page{height:4000px}</style>
  <div class="page">contenuto lungo</div>
  <div id="cookie-notice" style="position:fixed;left:0;right:0;bottom:0;height:160px;background:#fff;z-index:1001">
    <p>Questo sito usa i cookie: accetta, oppure abbonati.</p>
    <button onclick="document.cookie='tracking=1; path=/';window.__accepted=true">Accetta e continua</button>
  </div>`;

test('pagine interne: niente moduli dei cookie, il resto dei content script c’è e nessuno fallisce', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const errori = [];
  app.on('window', (w) => w.on('console', (m) => { if (m.type() === 'error' && /\[Filo CS\]/.test(m.text())) errori.push(`${w.url()}: ${m.text()}`); }));
  for (const url of INTERNE) {
    const page = await openTab(url);
    await page.waitForFunction(() => typeof globalThis.SN_MENU !== 'undefined', null, { timeout: 15_000 });
    const g = await page.evaluate(() => ({
      rules: typeof globalThis.SN_COOKIE_RULES,
      banners: typeof globalThis.SN_COOKIE_BANNERS,
      cookies: typeof globalThis.SN_COOKIES_CS,
      menu: typeof globalThis.SN_MENU,
    }));
    expect(g, url).toEqual({ rules: 'undefined', banners: 'undefined', cookies: 'undefined', menu: 'object' });
  }
  expect(errori).toEqual([]);
});

test('pagina web: il modulo dei cookie è montato e un banner senza «rifiuta» sparisce senza accettare', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-notice'));
  const page = await testServer.openReady(openTab, SOLO_ACCETTA);
  expect(await page.evaluate(() => document.documentElement.dataset.filoModules)).toContain('SN_COOKIES_CS');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 15_000 });
  expect(await page.evaluate(() => [window.__accepted, document.cookie.includes('tracking')])).toEqual([undefined, false]);
});
