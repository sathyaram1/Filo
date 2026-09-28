// #754 giro 4, rilievo 1: dimenticare la risposta al banner non deve portare via accesso, stato e preferenze del sito.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tabCookies(shell) {
  return shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === snap.activeId);
    return t ? t.cookies : undefined;
  });
}

async function bannerSiti(shell, show) {
  const { activeId } = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  return shell.evaluate(({ id, s }) => window.filoShell.tabs.cookieBanners(id, s), { id: activeId, s: show });
}

function iubenda(extra) {
  return `
    if (!document.cookie.includes('_iub_cs-1=')) setTimeout(() => {
      const b = document.createElement('div');
      b.id = 'iubenda-cs-banner';
      b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:120px;background:#fff;z-index:9';
      b.innerHTML = '<p>Usiamo i cookie per la pubblicità.</p>'
        + '<button class="iubenda-cs-accept-btn" style="width:120px;height:40px">Accetta</button>'
        + '<button class="iubenda-cs-reject-btn" style="width:120px;height:40px">Rifiuta</button>';
      b.querySelector('.iubenda-cs-reject-btn').onclick = () => { document.cookie = '_iub_cs-1=rifiutato; path=/; max-age=86400'; b.remove(); };
      b.querySelector('.iubenda-cs-accept-btn').onclick = () => { document.cookie = '_iub_cs-1=accettato; path=/; max-age=86400'; b.remove(); };
      document.body.appendChild(b);
    }, 400);
    ${extra || ''}`;
}

// Applicazione a pagina unica: tiene lo stato (accesso compreso) in una chiave sola della memoria della pagina,
// riscritta a ogni cambiamento mentre carica i dati, come vuex-persistedstate e redux-persist.
const SPA_IUBENDA = `<title>SPA</title>
  <div id="app"></div>
  <script>
    const state = JSON.parse(localStorage.getItem('vuex') || 'null') || { user: null, feed: [] };
    const save = () => localStorage.setItem('vuex', JSON.stringify(state));
    save();
    let n = 0;
    const t = setInterval(() => { state.feed.push(++n); save(); if (n >= 16) clearInterval(t); }, 250);
    window.accedi = () => { state.user = 'mario'; save(); };
    ${iubenda()}
  </script>`;

test('applicazione a pagina unica: Filo rifiuta, l\'utente accede, «Mostra il banner»: l\'accesso resta', async ({ openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, SPA_IUBENDA);
  await page.waitForFunction(() => document.cookie.includes('_iub_cs-1=rifiutato'), null, { timeout: 10_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await sleep(4000);
  await page.evaluate(() => window.accedi());
  await bannerSiti(shell, true);
  await expect.poll(() => page.evaluate(() => !!document.getElementById('iubenda-cs-banner')).catch(() => false), { timeout: 10_000 }).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vuex')).user)).toBe('mario');
});

// Banner fatto in casa: l'applicazione tiene la risposta nel suo stato, insieme al resto.
const SPA_CASA = `<title>SPA2</title>
  <div id="app"></div>
  <script>
    const state = JSON.parse(localStorage.getItem('vuex') || 'null') || { user: null, consent: null };
    const save = () => localStorage.setItem('vuex', JSON.stringify(state));
    save();
    window.accedi = () => { state.user = 'mario'; save(); };
    if (!state.consent) {
      const b = document.createElement('div');
      b.className = 'cookie-banner';
      b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:120px;background:#fff;z-index:9';
      b.innerHTML = '<p>Usiamo i cookie.</p><button id="ok" style="width:120px;height:40px">Accetta</button>';
      b.querySelector('#ok').onclick = () => { state.consent = 'tutti'; save(); b.remove(); };
      document.body.appendChild(b);
    }
  </script>`;

test('coi banner mostrati l\'utente accede e accetta, poi «Rifiuta i cookie in automatico qui»: l\'accesso resta', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { bannerSites: ['127.0.0.1'] } } });
  });
  const page = await testServer.openReady(openTab, SPA_CASA);
  await page.waitForSelector('.cookie-banner #ok', { timeout: 8_000 });
  await sleep(1500);
  await page.evaluate(() => window.accedi());
  await page.click('.cookie-banner #ok');
  await sleep(2500);
  await bannerSiti(shell, false);
  await sleep(4000);
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('vuex') || 'null') || {}).user)).toBe('mario');
});

// Un negozio che scrive la valuta dopo aver capito da dove si collega l'utente, mentre compare il banner.
const NEGOZIO = `<title>NEGOZIO</title>
  <p>vetrina</p>
  <script>
    setTimeout(() => { if (!document.cookie.includes('valuta=')) document.cookie = 'valuta=CHF; path=/; max-age=86400'; }, 700);
    ${iubenda()}
  </script>`;

test('negozio: la valuta scritta mentre Filo rifiuta resta dopo «Mostra il banner»', async ({ openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, NEGOZIO);
  await page.waitForFunction(() => document.cookie.includes('_iub_cs-1=rifiutato'), null, { timeout: 10_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await sleep(2500);
  expect(await page.evaluate(() => document.cookie)).toContain('valuta=CHF');
  await bannerSiti(shell, true);
  await expect.poll(() => page.evaluate(() => !!document.getElementById('iubenda-cs-banner')).catch(() => false), { timeout: 10_000 }).toBe(true);
  expect(await page.evaluate(() => document.cookie)).toContain('valuta=CHF');
});
