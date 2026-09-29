// Giro 1 di main-verde: i moduli dei banner dei cookie girano sulle pagine web e non sulle pagine interne,
// e le pagine interne caricano il resto dei content script senza errori di caricamento.
import { test, expect } from '../../fixtures/electron.mjs';

const INTERNE = ['filo://security/', 'filo://history/', 'filo://options/options.html', 'filo://dashboard/'];

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
      markdown: typeof globalThis.SN_FILO_MARKDOWN,
      menu: typeof globalThis.SN_MENU,
    }));
    expect(g, url).toMatchObject({ rules: 'undefined', banners: 'undefined', cookies: 'undefined', menu: 'object' });
  }
  expect(errori).toEqual([]);
});

test('pagina web: il modulo dei cookie è montato e un banner senza «rifiuta» di un CMP noto sparisce', async ({ openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<title>WEB_COOKIE</title>
    <div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#eee;z-index:99">
      <p>Usiamo i cookie.</p><button id="onetrust-accept-btn-handler">Accetta</button>
      <button id="onetrust-reject-all-handler" onclick="window.__rifiutato=1;document.getElementById('onetrust-consent-sdk').remove()">Rifiuta tutto</button>
    </div></div><p>contenuto</p>`);
  expect(await page.evaluate(() => document.documentElement.dataset.filoModules)).toContain('SN_COOKIES_CS');
  await page.waitForFunction(() => !document.getElementById('onetrust-banner-sdk'), null, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__rifiutato)).toBe(1);
});
