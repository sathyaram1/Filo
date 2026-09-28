// Esplorazione del giro 5 di #754 (si cancella o si rinomina prima della critica).

import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="cookie-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  return sec;
}

async function tabCookies(shell) {
  return shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === snap.activeId);
    return t ? t.cookies : undefined;
  });
}

async function rightClickTab(shell) {
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
    }));
  });
}

async function tryClick(app, needle, labelRe) {
  for (const w of app.windows()) {
    try {
      const r = await w.evaluate(({ n, l }) => {
        if (!document.body || !document.body.innerText.includes(n)) return 'no';
        const btn = [...document.querySelectorAll('button.item')].find((b) => new RegExp(l).test(b.textContent));
        if (!btn) return 'no';
        btn.click();
        return 'yes';
      }, { n: needle, l: labelRe });
      if (r === 'yes') return true;
    } catch (_) {}
  }
  return false;
}

async function clickUntil(app, { open, needle, labelRe, until, timeout = 25_000 }) {
  await expect.poll(async () => {
    if (await until()) return true;
    await open();
    for (let i = 0; i < 15; i++) { if (await tryClick(app, needle, labelRe)) break; await sleep(40); }
    await sleep(200);
    return await until();
  }, { timeout, intervals: [200, 300, 450, 600, 800, 1000, 1200] }).toBe(true);
}

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

// ── A: la memoria dei siti segue la modalità del momento del salvataggio ─────────────────────────────

test('A1 Privacy e poi Automatico: il sito visitato in Privacy non finisce sul disco', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  await setMode(openTab, 'privacy');
  const page = await testServer.openReady(openTab, RICORDA);
  await page.waitForFunction(() => !document.getElementById('onetrust-banner-sdk'), null, { timeout: 8_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await sleep(1500);
  const primo = await app.evaluate(async () => globalThis.SN_STORAGE.getRaw('cookieSites', null));
  expect(primo && primo['127.0.0.1']).toBeFalsy();
  await setMode(openTab, 'default');
  await sleep(2500);
  const dopo = await app.evaluate(async () => globalThis.SN_STORAGE.getRaw('cookieSites', null));
  expect(dopo && dopo['127.0.0.1']).toBeFalsy();
});

test('A2 Automatico e poi Privacy: il sito rifiutato in Automatico resta sul disco', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, RICORDA);
  await page.waitForFunction(() => document.cookie.includes('OptanonConsent=rifiutato'), null, { timeout: 8_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await expect.poll(async () => {
    const d = await app.evaluate(async () => globalThis.SN_STORAGE.getRaw('cookieSites', null));
    return !!(d && d['127.0.0.1'] && d['127.0.0.1'].rejected);
  }, { timeout: 6_000 }).toBe(true);
  await setMode(openTab, 'privacy');
  await sleep(2500);
  const dopo = await app.evaluate(async () => globalThis.SN_STORAGE.getRaw('cookieSites', null));
  expect(!!(dopo && dopo['127.0.0.1'] && dopo['127.0.0.1'].rejected)).toBe(true);
});

// ── B: la risposta scritta dalla pagina quando il banner sta in un riquadro, o dopo un'attesa ─────────

function spFramePage(testServer) {
  const frame = testServer.html(`<title>SP_FRAME</title>
    <div class="message-container"><div class="message type-modal" style="padding:20px">
      <p>Usiamo i cookie per personalizzare la pubblicità.</p>
      <button class="message-component message-button sp_choice_type_11" title="Accept"
        onclick="parent.postMessage('sp:accept','*')">Accetta</button>
      <button class="message-component message-button sp_choice_type_13" title="Reject All"
        onclick="parent.postMessage('sp:reject','*')">Rifiuta</button>
    </div></div>`).replace('127.0.0.1', 'blocked.test');
  return `<title>SP_TOP</title>
    <p>contenuto</p>
    <script>
      if (!document.cookie.includes('scelta_privacy=')) {
        document.write('<div id="sp_message_container_1" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99;display:flex;align-items:center;justify-content:center"><iframe id="sp_message_iframe_1" src="${frame}" style="width:520px;height:320px;border:0;background:#fff"></iframe></div>');
      }
      addEventListener('message', (e) => {
        if (e.data !== 'sp:reject' && e.data !== 'sp:accept') return;
        document.cookie = 'scelta_privacy=' + (e.data === 'sp:reject' ? 'no' : 'si') + '; path=/; max-age=86400';
        const c = document.getElementById('sp_message_container_1');
        if (c) c.remove();
      });
    </script>`;
}

test('B1 riquadro con la risposta scritta dalla pagina: «Mostra il banner dei cookie» lo riporta', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, spFramePage(testServer));
  await page.waitForFunction(() => document.cookie.includes('scelta_privacy=no'), null, { timeout: 12_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await sleep(500);
  await clickUntil(app, {
    open: () => rightClickTab(shell),
    needle: 'Mostra il banner dei cookie', labelRe: 'Mostra il banner dei cookie',
    until: async () => (await tabCookies(shell))?.shown === true,
  });
  await expect.poll(() => page.evaluate(() => !!document.getElementById('sp_message_container_1')).catch(() => false), { timeout: 10_000 }).toBe(true);
});

const ATTESA = `<title>ATTESA</title>
  <script>
    if (!document.cookie.includes('scelta_sito=')) {
      document.write('<div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff"><p>Usiamo i cookie.</p>'
        + '<button id="acc" onclick="salva(\\'si\\')">Accetta</button> <button id="rif" onclick="salva(\\'no\\')">Rifiuta</button></div>');
    }
    function salva(v) {
      fetch(location.href).then(() => {
        document.cookie = 'scelta_sito=' + v + '; path=/; max-age=86400';
        const b = document.getElementById('cookie-banner'); if (b) b.remove();
      });
    }
  </script>`;

test('B2 banner che si segna la risposta dopo una richiesta al server: «Mostra il banner dei cookie» lo riporta', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, ATTESA);
  await page.waitForFunction(() => document.cookie.includes('scelta_sito=no'), null, { timeout: 12_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await sleep(500);
  await clickUntil(app, {
    open: () => rightClickTab(shell),
    needle: 'Mostra il banner dei cookie', labelRe: 'Mostra il banner dei cookie',
    until: async () => (await tabCookies(shell))?.shown === true,
  });
  await expect.poll(() => page.evaluate(() => !!document.getElementById('cookie-banner')).catch(() => false), { timeout: 10_000 }).toBe(true);
});

// ── C: la linguetta per riaprire le preferenze (CookieLawInfo) dopo il rifiuto ─────────────────────────

const CLI = `<title>CLI</title>
  <style>body{margin:0} .page{height:3000px}</style>
  <div class="page">contenuto</div>
  <script>
    const risposto = document.cookie.includes('cookielawinfo-checkbox-advertisement=');
    if (!risposto) {
      document.write('<div id="cookie-law-info-bar" style="position:fixed;bottom:0;left:0;right:0;height:90px;background:#fff;box-sizing:border-box;padding:10px">'
        + '<span>Questo sito usa i cookie. <a role="button" id="cookie_action_close_header" class="cli_action_button" onclick="rispondi(\\'yes\\')">Accetta</a> '
        + '<a role="button" id="cookie_action_close_header_reject" class="cookie_action_close_header_reject cli_action_button" onclick="rispondi(\\'no\\')">Rifiuta</a></span></div>');
    }
    document.write('<div id="cookie-law-info-again" style="position:fixed;bottom:0;right:100px;width:160px;height:28px;background:#eee;display:' + (risposto ? 'block' : 'none') + '"><span id="cookie_hdr_showagain">Privacy e cookie</span></div>');
    function rispondi(v) {
      document.cookie = 'cookielawinfo-checkbox-advertisement=' + v + '; path=/; max-age=86400';
      document.cookie = 'viewed_cookie_policy=' + v + '; path=/; max-age=86400';
      document.getElementById('cookie-law-info-bar').remove();
      document.getElementById('cookie-law-info-again').style.display = 'block';
    }
  </script>`;

test('C1 CookieLawInfo: alla seconda pagina il menu non dice «Banner dei cookie nascosto»', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-law-info-bar\n###cookie-law-info-again'));
  const url = testServer.html(CLI);
  const a = await openTab(url);
  await a.waitForFunction(() => document.cookie.includes('cookielawinfo-checkbox-advertisement=no'), null, { timeout: 10_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await sleep(1500);
  await a.reload();
  await a.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  await sleep(3000);
  const tab = await a.evaluate(() => getComputedStyle(document.getElementById('cookie-law-info-again')).display);
  const ck = await tabCookies(shell);
  console.log('linguetta', tab, JSON.stringify(ck));
  expect(ck.hidden).toBe(false);
});

// ── D: la pagina Sicurezza con i due elenchi, tema chiaro e scuro ──────────────────────────────────────

test('D1 Sicurezza, i due elenchi a schermo', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, RICORDA);
  await page.waitForFunction(() => document.cookie.includes('OptanonConsent=rifiutato'), null, { timeout: 8_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await app.evaluate(async () => {
    await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { bannerSites: ['esempio.it', 'giornale-molto-lungo-con-un-nome-lunghissimo.example.com'] } } });
  });
  const sec = await openTab('filo://security/');
  await expect(sec.locator('#cookie-done-list li')).toHaveCount(1, { timeout: 8_000 });
  await sec.locator('#sec-cookies').scrollIntoViewIfNeeded();
  await sec.locator('#sec-cookies-done').scrollIntoViewIfNeeded();
  await sec.screenshot({ path: 'tests/.shots/754-g5-sicurezza-chiaro.png', fullPage: false });
  await sec.emulateMedia({ colorScheme: 'dark' });
  await sec.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await sleep(500);
  await sec.screenshot({ path: 'tests/.shots/754-g5-sicurezza-scuro.png', fullPage: false });
});
