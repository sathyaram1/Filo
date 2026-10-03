// #737 — una pubblicità che si può saltare la salta Filo, appena il lettore mostra «Salta».
// YouTube ignora i clic fabbricati da uno script: lì il «Salta» lo preme il main con un clic vero, e solo lì.
// Il lettore di YouTube qui è finto e servito sotto www.youtube.com (host-resolver-rules): la rete vera non serve.

import { test as base, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const test = base.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-adskip-');
    const app = await electron.launch({
      args: [...argomentiScala, '--host-resolver-rules=MAP www.youtube.com 127.0.0.1, MAP sito-pubblico.test 127.0.0.1', '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

// Un lettore con la pubblicità in corso: il «Salta» compare dopo `dopoMs`, come dopo i cinque secondi di YouTube.
// Con `soloVeri` un clic fabbricato non salta niente, come su YouTube.
function lettore({ classe = 'ytp-skip-ad-button', soloVeri = true, dopoMs = 1200, campo = false, titolo = 'Lettore' } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${titolo}</title><style>
  body{margin:0;font:14px sans-serif}
  #movie_player{position:relative;width:640px;height:360px;background:#222;margin:20px}
  #slot{position:absolute;right:0;bottom:60px;display:none}
  #slot button{padding:10px 22px;font:16px sans-serif}
  </style></head><body>
  ${campo ? '<input id="cerca" placeholder="cerca">' : ''}
  <div id="movie_player" class="html5-video-player ad-showing">
    <video muted></video>
    <div id="slot"><button class="${classe}" id="salta">Salta</button></div>
  </div>
  <script>
    window.__clic = [];
    window.__saltata = false;
    document.getElementById('salta').addEventListener('click', (e) => {
      window.__clic.push({ vero: e.isTrusted, alle: Date.now() });
      if (${soloVeri ? '!e.isTrusted' : 'false'}) return;
      document.getElementById('movie_player').classList.remove('ad-showing');
      document.getElementById('slot').style.display = 'none';
      window.__saltata = true;
    });
    window.__mostra = () => { document.getElementById('slot').style.display = 'block'; window.__mostrataAlle = Date.now(); };
    ${dopoMs >= 0 ? `setTimeout(window.__mostra, ${dopoMs});` : ''}
  </script></body></html>`;
}

const stato = (page) => page.evaluate(() => ({
  clic: window.__clic, saltata: window.__saltata, mostrataAlle: window.__mostrataAlle || 0,
  attivato: navigator.userActivation.hasBeenActive,
}));

const suYouTube = (url) => url.replace('127.0.0.1', 'www.youtube.com');

async function apri(openTab, url) {
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  return page;
}

async function interruttore(app, acceso) {
  const filo = { tab: { id: 1, url: 'filo://security/security.html' }, url: 'filo://security/security.html' };
  await app.evaluate(async (_, a) => globalThis.SN_HANDLE_MESSAGE(
    { type: 'update_settings', settings: { security: { adSkip: { enabled: a.acceso } } } }, a.filo), { acceso, filo });
}

test('su YouTube il «Salta» si preme da solo appena compare, con un clic vero', async ({ openTab, testServer }) => {
  const page = await apri(openTab, suYouTube(testServer.html(lettore())));
  // Prima che il lettore lo mostri, niente.
  await page.waitForTimeout(600);
  expect((await stato(page)).clic).toEqual([]);
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 5_000 }).toBe(true);
  const s = await stato(page);
  expect(s.clic.length).toBe(1);
  expect(s.clic[0].vero).toBe(true);
  expect(s.clic[0].alle - s.mostrataAlle).toBeLessThan(1500);
  await expect(page.locator('#movie_player')).not.toHaveClass(/ad-showing/);
});

test('una serie di pubblicità: il «Salta» che ricompare si preme di nuovo', async ({ openTab, testServer }) => {
  const page = await apri(openTab, suYouTube(testServer.html(lettore())));
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 5_000 }).toBe(true);
  await page.evaluate(() => { window.__saltata = false; window.__mostra(); });
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 5_000 }).toBe(true);
  const s = await stato(page);
  expect(s.clic.filter((c) => c.vero).length).toBe(2);
});

test('con la pagina ingrandita il clic vero cade ancora sul «Salta»', async ({ app, openTab, testServer }) => {
  const page = await apri(openTab, suYouTube(testServer.html(lettore({ dopoMs: -1 }))));
  await app.evaluate(({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => { try { return new URL(w.getURL()).hostname === 'www.youtube.com'; } catch (_) { return false; } });
    wc.setZoomFactor(1.5);
  });
  await expect.poll(() => page.evaluate(() => window.devicePixelRatio), { timeout: 5_000 }).toBeGreaterThan(1.4);
  await page.evaluate(() => window.__mostra());
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 5_000 }).toBe(true);
  expect((await stato(page)).clic.every((c) => c.vero)).toBe(true);
});

test('mentre si scrive in un campo della pagina aspetta, poi salta', async ({ openTab, testServer }) => {
  const page = await apri(openTab, suYouTube(testServer.html(lettore({ dopoMs: -1, campo: true }))));
  await page.locator('#cerca').click();
  await page.keyboard.type('gatti');
  await page.evaluate(() => window.__mostra());
  await page.waitForTimeout(1500);
  let s = await stato(page);
  expect(s.saltata).toBe(false);
  expect(s.clic).toEqual([]);
  await expect(page.locator('#cerca')).toBeFocused();
  await page.evaluate(() => document.getElementById('cerca').blur());
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 5_000 }).toBe(true);
  s = await stato(page);
  expect(s.clic.every((c) => c.vero)).toBe(true);
  expect(await page.locator('#cerca').inputValue()).toBe('gatti');
});

test('negli altri lettori basta il clic dello script, anche dentro un riquadro', async ({ openTab, testServer }) => {
  const dentro = testServer.html(lettore({ classe: 'videoAdUiSkipButton', soloVeri: false, titolo: 'IMA' }), { pubblico: true });
  const page = await apri(openTab, testServer.html(`<!doctype html><title>Ospite</title><body>
    <p>articolo</p><iframe id="pub" src="${dentro}" width="720" height="420"></iframe></body>`));
  const frame = await expect.poll(() => page.frames().find((f) => f.url() === dentro) || null, { timeout: 5_000 }).not.toBeNull()
    .then(() => page.frames().find((f) => f.url() === dentro));
  await expect.poll(() => frame.evaluate(() => window.__saltata), { timeout: 6_000 }).toBe(true);
  const s = await frame.evaluate(() => ({ clic: window.__clic, attivato: navigator.userActivation.hasBeenActive }));
  expect(s.clic.length).toBe(1);
  expect(s.clic[0].vero).toBe(false);
  expect(s.attivato).toBe(false);
});

test('fuori da YouTube un «Salta» di YouTube non riceve mai un clic vero', async ({ openTab, testServer }) => {
  // Un sito qualunque può disegnarsi un pulsante con quella classe: un clic vero gli regalerebbe un gesto dell'utente.
  const page = await apri(openTab, testServer.html(lettore()));
  await expect.poll(async () => (await stato(page)).clic.length, { timeout: 5_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2500);
  const s = await stato(page);
  expect(s.saltata).toBe(false);
  expect(s.clic.some((c) => c.vero)).toBe(false);
  expect(s.attivato).toBe(false);
});

test('spento non tocca niente; riacceso preme il «Salta» già a schermo', async ({ app, openTab, testServer }) => {
  await interruttore(app, false);
  const page = await apri(openTab, suYouTube(testServer.html(lettore({ dopoMs: 300 }))));
  await page.waitForTimeout(2000);
  expect((await stato(page)).clic).toEqual([]);
  await interruttore(app, true);
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 5_000 }).toBe(true);
});

test('l\'interruttore sta in Sicurezza, sotto il blocco delle pubblicità, e spegne davvero', async ({ app, openTab, testServer }) => {
  const sec = await openTab('filo://security/security.html');
  await sec.waitForSelector('#sec-adskip', { timeout: 8_000 });
  await expect(sec.locator('#sec-adskip')).toBeChecked();
  await expect(sec.locator('#sec-adskip-label')).toHaveText('Salta le pubblicità dei video');
  const y = async (sel) => (await sec.locator(sel).boundingBox()).y;
  expect(await y('#sec-adskip')).toBeGreaterThan(await y('#sec-adblock'));
  await sec.locator('#sec-adskip').uncheck();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.adSkip.enabled)).toBe(false);

  const page = await apri(openTab, suYouTube(testServer.html(lettore({ dopoMs: 300 }))));
  await page.waitForTimeout(2000);
  expect((await stato(page)).clic).toEqual([]);

  await sec.bringToFront().catch(() => {});
  const shots = join(APP_ROOT, 'tests', '.shots');
  for (const tema of ['light', 'dark']) {
    await sec.emulateMedia({ colorScheme: tema });
    await sec.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
    await sec.locator('#sec-adskip').scrollIntoViewIfNeeded();
    await sec.screenshot({ path: join(shots, `ad-skip-sicurezza-${tema}.png`) });
  }
});
