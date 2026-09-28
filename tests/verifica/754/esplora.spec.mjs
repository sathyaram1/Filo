// Esplorazione del giro 4 di #754: si cancella prima della consegna.
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

// Un'applicazione a pagina unica che tiene il suo stato (login compreso) in una chiave della memoria della pagina,
// riscritta a ogni cambiamento mentre carica i dati, come fanno vuex-persistedstate e redux-persist.
const SPA_IUBENDA = `<title>SPA</title>
  <div id="app"></div>
  <script>
    const state = JSON.parse(localStorage.getItem('vuex') || 'null') || { user: null, feed: [] };
    const save = () => localStorage.setItem('vuex', JSON.stringify(state));
    save();
    let n = 0;
    const t = setInterval(() => { state.feed.push(++n); save(); if (n >= 16) clearInterval(t); }, 250);
    window.accedi = () => { state.user = 'mario'; save(); };
    document.getElementById('app').textContent = state.user ? 'Ciao ' + state.user : 'Accedi';
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
  </script>`;

test('SPA: Filo rifiuta, l\'utente accede, «Mostra il banner»: l\'accesso resta', async ({ openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, SPA_IUBENDA);
  await page.waitForFunction(() => document.cookie.includes('_iub_cs-1=rifiutato'), null, { timeout: 10_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await sleep(4000);
  await page.evaluate(() => window.accedi());
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vuex')).user)).toBe('mario');
  await bannerSiti(shell, true);
  await expect.poll(() => page.evaluate(() => !!document.getElementById('iubenda-cs-banner')).catch(() => false), { timeout: 10_000 }).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vuex')).user)).toBe('mario');
});

// Banner fatto in casa: la risposta l'applicazione la tiene nel suo stato, insieme al resto.
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

test('SPA coi banner mostrati: l\'utente accede e accetta, poi «Rifiuta in automatico qui»: l\'accesso resta', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { bannerSites: ['127.0.0.1'] } } });
  });
  const page = await testServer.openReady(openTab, SPA_CASA);
  await page.waitForSelector('.cookie-banner #ok', { timeout: 8_000 });
  await sleep(1500);
  await page.evaluate(() => window.accedi());
  await page.click('.cookie-banner #ok');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vuex')))).toEqual({ user: 'mario', consent: 'tutti' });
  await sleep(2500);
  await bannerSiti(shell, false);
  await sleep(4000);
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('vuex') || 'null') || {}).user)).toBe('mario');
});

const RICORDA = `<title>RICORDA</title>
  <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff">
    <button id="onetrust-accept-btn-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=accettato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Accetta tutto</button>
    <button id="onetrust-reject-all-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=rifiutato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Rifiuta tutto</button>
  </div>
  <script>
    if (document.cookie.includes('OptanonConsent=')) document.getElementById('onetrust-banner-sdk').remove();
  </script>`;

test('Privacy: l\'elenco dei siti visitati non resta sul disco', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 8_000 });
  await sec.locator('input[name="cookie-mode"][value="privacy"]').check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  const page = await testServer.openReady(openTab, RICORDA);
  await page.waitForFunction(() => !document.getElementById('onetrust-banner-sdk'), null, { timeout: 8_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await sleep(2000);
  const raw = await app.evaluate(async () => globalThis.SN_STORAGE.getRaw('cookieSites', null));
  console.log('cookieSites', JSON.stringify(raw));
  expect(raw && raw['127.0.0.1']).toBeFalsy();
});
