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

// Risposta tenuta solo nella memoria della pagina, come Usercentrics («uc_settings»).
const UC = `<title>UC</title>
  <p>contenuto</p>
  <script>
    const ans = localStorage.getItem('uc_settings');
    if (!ans) {
      const b = document.createElement('div');
      b.className = 'cookie-banner';
      b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:120px;background:#fff;z-index:9';
      b.innerHTML = '<p>Usiamo i cookie.</p><button id="acc" style="width:120px;height:40px">Accetta tutto</button>'
        + '<button id="rif" style="width:120px;height:40px">Rifiuta tutto</button>';
      b.querySelector('#acc').onclick = () => { localStorage.setItem('uc_settings', 'accettato'); b.remove(); };
      b.querySelector('#rif').onclick = () => { localStorage.setItem('uc_settings', 'rifiutato'); b.remove(); };
      document.body.appendChild(b);
    }
  </script>`;

test('Sicurezza: tolto il sito dall\'elenco coi banner, Filo torna a rifiutare anche se la risposta sta nella memoria della pagina', async ({ openTab, testServer, shell }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, UC);
  await page.waitForFunction(() => localStorage.getItem('uc_settings') === 'rifiutato', null, { timeout: 10_000 });
  await sleep(2000);
  await bannerSiti(shell, true);
  await expect.poll(() => page.evaluate(() => !!document.querySelector('.cookie-banner #acc')).catch(() => false), { timeout: 10_000 }).toBe(true);
  await page.click('.cookie-banner #acc');
  expect(await page.evaluate(() => localStorage.getItem('uc_settings'))).toBe('accettato');
  await sleep(2000);
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#cookie-banners-list li button', { timeout: 8_000 });
  await sec.locator('#cookie-banners-list li button').first().click();
  await expect(sec.locator('#sec-cookies-banners')).toBeHidden({ timeout: 6_000 });
  await sleep(1500);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  await sleep(5000);
  expect(await page.evaluate(() => localStorage.getItem('uc_settings'))).toBe('rifiutato');
});

test('aspetto: menu della scheda e Sicurezza, chiaro e scuro', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, RICORDA);
  await page.waitForFunction(() => !document.getElementById('onetrust-banner-sdk'), null, { timeout: 8_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  for (const tema of ['light', 'dark']) {
    await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, tema);
    await sleep(800);
    let menu = null;
    await expect.poll(async () => {
      await shell.evaluate(() => {
        const el = document.querySelector('.tab.active') || document.querySelector('.tab');
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
      });
      await sleep(400);
      for (const w of app.windows()) {
        try { if (await w.evaluate(() => document.body && document.body.innerText.includes('Cookie non necessari rifiutati'))) { menu = w; return true; } } catch (_) {}
      }
      return false;
    }, { timeout: 15_000 }).toBe(true);
    await sleep(400);
    await menu.screenshot({ path: `tests/.shots/754-giro4-menu-${tema}.png` });
    await menu.keyboard.press('Escape').catch(() => {});
  }
  await app.evaluate(async () => {
    await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { bannerSites: ['127.0.0.1', 'corriere.it', 'un-sito-dal-nome-lunghissimo-per-vedere-come-va-a-capo.example.com'] } } });
  });
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#cookie-banners-list li', { timeout: 8_000 });
  for (const tema of ['light', 'dark']) {
    await app.evaluate(async ({ nativeTheme }, t) => { nativeTheme.themeSource = t; await globalThis.__filoHandlers.applySettingsUpdate({ theme: t }); }, tema);
    await sleep(1200);
    await sec.locator('#sec-cookies-banners').scrollIntoViewIfNeeded();
    await sec.screenshot({ path: `tests/.shots/754-giro4-sicurezza-${tema}.png` });
  }
});

test('controprova: stessa pagina, «Rifiuta i cookie in automatico qui» dal menu della scheda', async ({ openTab, testServer, shell }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, UC);
  await page.waitForFunction(() => localStorage.getItem('uc_settings') === 'rifiutato', null, { timeout: 10_000 });
  await sleep(2000);
  await bannerSiti(shell, true);
  await expect.poll(() => page.evaluate(() => !!document.querySelector('.cookie-banner #acc')).catch(() => false), { timeout: 10_000 }).toBe(true);
  await page.click('.cookie-banner #acc');
  await sleep(2000);
  await bannerSiti(shell, false);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('uc_settings')).catch(() => null), { timeout: 12_000 }).toBe('rifiutato');
});

const ESTRATTO = ['###cookie-banner', '###didomi-notice', '##.qc-cmp2-container', 'kooora.com##div[id^="sp_message_container_"]'].join('\n');
function spAbbonatiFrame(testServer) {
  return testServer.html(`<title>SP_PAY_FRAME</title>
    <div class="message-container"><div id="notice" class="message type-modal" style="padding:20px">
      <div class="message-component message-row"><p class="message-component">Accetta i cookie per la pubblicità, oppure abbonati.</p></div>
      <div class="message-component message-row">
        <button class="message-component message-button no-children focusable sp_choice_type_11" title="Accetta e continua"
          onclick="parent.postMessage('sp:accept','*')">Accetta e continua</button>
        <button class="message-component message-button no-children focusable sp_choice_type_9" title="Abbonati"
          onclick="parent.postMessage('sp:subscribe','*')">Abbonati</button>
      </div>
    </div></div>`).replace('127.0.0.1', 'blocked.test');
}
const articolo = (testServer) => `<title>SP_PAY_TOP</title>
    <style>html.sp-message-open{overflow:hidden!important} body{height:4000px;margin:0}</style>
    <div id="sp_message_container_1"
      style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483647;display:flex;align-items:center;justify-content:center">
      <iframe id="sp_message_iframe_1" src="${spAbbonatiFrame(testServer)}" style="width:560px;height:300px;border:0;background:#fff"></iframe>
    </div>
    <h1>Articolo</h1><p>contenuto</p>
    <script>
      document.documentElement.classList.add('sp-message-open');
      window.__t0 = performance.now();
      const iv = setInterval(() => {
        const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        if (el && !el.closest('#sp_message_container_1')) { window.__hiddenAt = performance.now(); clearInterval(iv); }
      }, 50);
    </script>`;

test('misura: quanto resta davanti il muro «accetta o abbonati», primo e secondo articolo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), ESTRATTO);
  const page = await testServer.openReady(openTab, articolo(testServer));
  for (let i = 0; i < 3; i++) {
    if (i) await page.goto(testServer.html(articolo(testServer)));
    await page.waitForFunction(() => window.__hiddenAt, null, { timeout: 20_000 });
    console.log('articolo', i + 1, 'muro visibile per ms', Math.round(await page.evaluate(() => window.__hiddenAt)));
  }
});

const googleFcSenza = `<title>GOOGLE_FC</title>
  <style>body{margin:0} .page{height:4000px}</style>
  <div class="page">ricetta lunga</div>
  <div class="fc-consent-root" dir="ltr" tabindex="0">
    <div class="fc-dialog-container" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:2147483646">
      <div class="fc-dialog fc-choice-dialog" role="dialog" aria-modal="true" style="background:#fff;width:500px;padding:20px">
        <h1 class="fc-dialog-headline">Il sito ricette.example chiede il consenso all'utilizzo dei tuoi dati personali per:</h1>
        <div class="fc-footer-buttons">
          <button class="fc-button fc-cta-consent" onclick="window.__fc='si'"><p class="fc-button-label">Acconsento</p></button>
          <button class="fc-button fc-cta-manage-options"><p class="fc-button-label">Gestisci opzioni</p></button>
        </div>
      </div>
    </div>
    <div class="fc-dialog-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483645"></div>
  </div>
  <script>document.body.style.overflow='hidden';
    const iv = setInterval(() => { if (document.querySelector('.fc-dialog').getBoundingClientRect().height === 0) { window.__hiddenAt = performance.now(); clearInterval(iv); } }, 50);</script>`;

const soloLista = `<title>LISTA</title><style>body{margin:0} .page{height:4000px}</style><div class="page">x</div>
  <div id="cookie-notice" style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#fff;z-index:1001">
    <p>Usiamo i cookie.</p><button>Accetta</button></div>
  <script>const iv = setInterval(() => { if (getComputedStyle(document.getElementById('cookie-notice')).display === 'none') { window.__hiddenAt = performance.now(); clearInterval(iv); } }, 50);</script>`;

test('misura: Google senza «Non acconsento» e banner della sola lista, due pagine di fila', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-notice'));
  const page = await testServer.openReady(openTab, googleFcSenza);
  for (let i = 0; i < 2; i++) {
    if (i) await page.goto(testServer.html(googleFcSenza));
    await page.waitForFunction(() => window.__hiddenAt, null, { timeout: 20_000 });
    console.log('google', i + 1, 'visibile per ms', Math.round(await page.evaluate(() => window.__hiddenAt)));
  }
  for (let i = 0; i < 2; i++) {
    await page.goto(testServer.html(soloLista));
    await page.waitForFunction(() => window.__hiddenAt, null, { timeout: 20_000 });
    console.log('lista', i + 1, 'visibile per ms', Math.round(await page.evaluate(() => window.__hiddenAt)));
  }
});

const otSolo = `<title>OT</title>
  <style>body{margin:0} .page{height:4000px}</style>
  <div class="page">contenuto</div>
  <div id="onetrust-consent-sdk">
    <div class="onetrust-pc-dark-filter" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483645"></div>
    <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:130px;background:#fff;z-index:2147483646">
      <p>Usiamo i cookie per migliorare la tua esperienza.</p>
      <button id="onetrust-pc-btn-handler" onclick="window.__pc=(window.__pc||0)+1;document.getElementById('onetrust-banner-sdk').style.display='none';document.getElementById('onetrust-pc-sdk').style.display='block';document.querySelector('.onetrust-pc-dark-filter').style.display='block'">Impostazioni cookie</button>
      <button id="onetrust-accept-btn-handler" onclick="window.__acc=1">Accetta tutti</button>
    </div>
    <div id="onetrust-pc-sdk" style="display:none;position:fixed;top:10%;left:25%;width:50%;height:60%;background:#fff;z-index:2147483647">
      <h2>Centro preferenze della privacy</h2>
      <label>Marketing <input type="checkbox" id="ot-mkt" checked></label>
      <button class="save-preference-btn-handler">Conferma le mie scelte</button>
    </div>
  </div>
  <script>const iv = setInterval(() => {
    const vis = (i) => { const e = document.getElementById(i); const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    if (!vis('onetrust-banner-sdk') && !vis('onetrust-pc-sdk') && getComputedStyle(document.getElementById('onetrust-consent-sdk')).display === 'none') { window.__hiddenAt = performance.now(); clearInterval(iv); } }, 50);</script>`;

test('misura: OneTrust col solo «Accetta», due pagine di fila', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###onetrust-banner-sdk\n###onetrust-consent-sdk\n##.onetrust-pc-dark-filter'));
  const page = await testServer.openReady(openTab, otSolo);
  for (let i = 0; i < 2; i++) {
    if (i) await page.goto(testServer.html(otSolo));
    await page.waitForFunction(() => window.__hiddenAt, null, { timeout: 20_000 });
    console.log('onetrust', i + 1, 'visibile per ms', Math.round(await page.evaluate(() => window.__hiddenAt)), 'pannello aperto da Filo', await page.evaluate(() => window.__pc || 0));
  }
});
