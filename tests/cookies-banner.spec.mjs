// Banner dei cookie (#754): rifiuto anche dentro i riquadri, regole Consent-O-Matic, banner senza «rifiuta»
// nascosti con la pagina sbloccata, e il segno nel menu della scheda con la strada per rivedere il banner.
// Le prove di base (GPC, OneTrust, YouTube, tracker) stanno in cookies.spec.mjs.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

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

// ── riquadro nella forma Sourcepoint, da un altro sito ─────────────────────────

function sourcepointPage(testServer) {
  const frame = testServer.html(`<title>SP_FRAME</title>
    <div class="message-container"><div class="message type-modal" style="padding:20px">
      <p>Usiamo i cookie per personalizzare la pubblicità.</p>
      <button class="message-component message-button sp_choice_type_11" title="Accept"
        onclick="parent.postMessage('sp:accept','*')">Accetta</button>
      <button class="message-component message-button sp_choice_type_13" title="Reject All"
        onclick="parent.postMessage('sp:reject','*')">Rifiuta</button>
    </div></div>`).replace('127.0.0.1', 'blocked.test');
  return `<title>SP_TOP</title>
    <div id="sp_message_container_1" class="sp_message_container_1"
      style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99;display:flex;align-items:center;justify-content:center">
      <iframe id="sp_message_iframe_1" src="${frame}" style="width:520px;height:320px;border:0;background:#fff"></iframe>
    </div>
    <p>contenuto</p>
    <script>
      addEventListener('message', (e) => {
        if (e.data !== 'sp:reject' && e.data !== 'sp:accept') return;
        window.__sp = e.data;
        if (e.data === 'sp:accept') document.cookie = 'tracking=1; path=/';
        document.getElementById('sp_message_container_1').remove();
      });
    </script>`;
}

test('banner dentro un riquadro (forma Sourcepoint, altro sito): Filo preme «Rifiuta» lì dentro', async ({ openTab, testServer, shell }) => {
  const page = await testServer.openReady(openTab, sourcepointPage(testServer));
  await page.waitForFunction(() => !document.getElementById('sp_message_container_1'), null, { timeout: 12_000 });
  expect(await page.evaluate(() => window.__sp)).toBe('sp:reject');
  expect(await page.evaluate(() => document.cookie)).not.toContain('tracking');
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
});

test('banner dentro un riquadro, modalità Manuale: resta dov\'è (controprova)', async ({ openTab, testServer }) => {
  await setMode(openTab, 'manual');
  const page = await testServer.openReady(openTab, sourcepointPage(testServer));
  await sleep(2500);
  expect(await page.evaluate(() => !!document.getElementById('sp_message_container_1'))).toBe(true);
  expect(await page.evaluate(() => window.__sp)).toBeUndefined();
});

// ── piattaforma che c'è solo fra le regole Consent-O-Matic (Truendo) ───────────

test('CMP presente solo nelle regole Consent-O-Matic: le categorie si spengono e la scelta si salva', async ({ openTab, testServer, shell }) => {
  const html = `<title>TRUENDO</title>
    <div id="truendo_container"><div class="truendo_panel">
      <div class="tru_cookie-dialog-main" style="position:fixed;left:0;right:0;bottom:0;min-height:140px;background:#333;color:#fff;padding:12px">
        <p>We use cookies.</p>
        <button id="tru_accept_btn" onclick="window.__accepted=true;document.cookie='tracking=1; path=/';document.getElementById('truendo_container').remove()">Accept all</button>
        <button id="tru_options_btn" onclick="document.getElementById('opts').style.display='block'">Options</button>
        <div id="opts" style="display:none">
          <div class="tru-expand"><span>Marketing</span> <input type="checkbox" id="mkt" checked></div>
          <div class="tru-expand"><span>Social Sharing</span> <input type="checkbox" id="soc" checked></div>
          <button data-cy="action-button-save"
            onclick="window.__saved={mkt:mkt.checked,soc:soc.checked};document.getElementById('truendo_container').remove()">Save</button>
        </div>
      </div>
    </div></div>
    <p>contenuto</p>`;
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => !document.getElementById('truendo_container'), null, { timeout: 12_000 });
  expect(await page.evaluate(() => window.__saved)).toEqual({ mkt: false, soc: false });
  expect(await page.evaluate(() => window.__accepted)).toBeUndefined();
  expect(await page.evaluate(() => document.cookie)).not.toContain('tracking');
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
});

// ── banner col solo «Accetta» (o «rifiuta e abbonati»): si nasconde ────────────

const SOLO_ACCETTA = `<title>SOLO_ACCETTA</title>
  <style>body{margin:0;overflow:hidden} .page{height:4000px;background:linear-gradient(#fff,#bbb)}</style>
  <div class="page">contenuto lungo</div>
  <div class="velo" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000"></div>
  <div id="cookie-notice" style="position:fixed;left:0;right:0;bottom:0;height:160px;background:#fff;z-index:1001;padding:16px">
    <p>Questo sito usa i cookie per la pubblicità: accetta, oppure abbonati.</p>
    <button onclick="document.cookie='tracking=1; path=/';window.__accepted=true">Accetta e continua</button>
    <button onclick="window.__subscribe=true">Rifiuta e abbonati</button>
  </div>`;

test('banner senza «rifiuta»: nascosto, pagina di nuovo scorrevole, nessun cookie di tracciamento', async ({ app, openTab, testServer, shell }) => {
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-notice'));
  const page = await testServer.openReady(openTab, SOLO_ACCETTA);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.velo')).display), { timeout: 6_000 }).toBe('none');
  await expect.poll(() => page.evaluate(() => { window.scrollTo(0, 600); return window.scrollY; }), { timeout: 6_000 }).toBeGreaterThan(300);
  expect(await page.evaluate(() => document.cookie)).not.toContain('tracking');
  expect(await page.evaluate(() => [window.__accepted, window.__subscribe])).toEqual([undefined, undefined]);
  await expect.poll(async () => (await tabCookies(shell))?.hidden, { timeout: 8_000 }).toBe(true);
});

test('banner senza «rifiuta» su un sito con CSP stretta sugli stili: si nasconde lo stesso', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-notice'));
  const page = await testServer.openReady(openTab, `<meta http-equiv="Content-Security-Policy" content="style-src 'self'">
    <title>CSP</title><p>contenuto</p>
    <div id="cookie-notice"><p>Usiamo i cookie.</p><button onclick="window.__accepted=true">Accetta</button></div>`);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 10_000 });
  expect(await page.evaluate(() => window.__accepted)).toBeUndefined();
});

test('banner senza «rifiuta», modalità Manuale: resta visibile (controprova)', async ({ app, openTab, testServer }) => {
  await setMode(openTab, 'manual');
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-notice'));
  const page = await testServer.openReady(openTab, SOLO_ACCETTA);
  await sleep(2000);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('cookie-notice')).display)).not.toBe('none');
});

// ── TCF: «rifiutati» si dice solo se il CMP l'ha registrato ────────────────────

function tcfPage(recordsReject) {
  return `<title>TCF</title>
    <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff">
      <button id="onetrust-reject-all-handler" style="width:140px;height:40px"
        onclick="${recordsReject ? 'window.__given=false;' : ''}document.getElementById('onetrust-banner-sdk').remove()">Rifiuta tutto</button>
    </div>
    <iframe name="__tcfapiLocator" style="display:none"></iframe>
    <script>
      window.__given = true;
      window.__tcfapi = function (cmd, v, cb) {
        if (cmd === 'getTCData') cb({ eventStatus: 'useractioncomplete', purpose: { consents: { 1: window.__given, 2: window.__given } } }, true);
        else if (cmd === 'ping') cb({ cmpLoaded: true, displayStatus: 'visible' }, true);
        else cb(null, false);
      };
      addEventListener('message', (e) => {
        const c = e.data && e.data.__tcfapiCall;
        if (!c) return;
        window.__asked = (window.__asked || 0) + 1;
        window.__tcfapi(c.command, c.version, (rv, ok) => e.source.postMessage({ __tcfapiReturn: { returnValue: rv, success: ok, callId: c.callId } }, '*'), c.parameter);
      });
    </script>`;
}

test('TCF: dopo il rifiuto Filo chiede al CMP se è registrato, e lo dice solo se lo è', async ({ openTab, testServer, shell }) => {
  const ok = await testServer.openReady(openTab, tcfPage(true));
  await ok.waitForFunction(() => !document.getElementById('onetrust-banner-sdk'), null, { timeout: 8_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  expect(await ok.evaluate(() => window.__asked)).toBeGreaterThan(0);

  const ko = await testServer.openReady(openTab, tcfPage(false));
  await ko.waitForFunction(() => !document.getElementById('onetrust-banner-sdk'), null, { timeout: 8_000 });
  await expect.poll(() => ko.evaluate(() => window.__asked || 0), { timeout: 8_000 }).toBeGreaterThan(1);
  await sleep(1500);
  expect((await tabCookies(shell))?.rejected).toBe(false);
});

// ── il segno nel menu della scheda, e «Mostra il banner dei cookie» ─────────────

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

async function readMenuOnce(app, needle) {
  for (const w of app.windows()) {
    try {
      const t = await w.evaluate((n) => (document.body && document.body.innerText.includes(n) ? document.body.innerText : null), needle);
      if (t != null) return t;
    } catch (_) {}
  }
  return null;
}

async function openAndRead(app, doOpen, needle, timeout = 15_000) {
  let text = null;
  await expect.poll(async () => {
    text = await readMenuOnce(app, needle);
    if (text != null) return true;
    await doOpen();
    await sleep(150);
    text = await readMenuOnce(app, needle);
    return text != null;
  }, { timeout, intervals: [150, 250, 400, 600, 800, 1000] }).toBe(true);
  return text;
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

// La pagina ricorda la risposta in un cookie di consenso, come fanno i CMP veri: il banner torna solo se Filo lo dimentica.
const RICORDA = `<title>RICORDA</title>
  <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff">
    <button id="onetrust-accept-btn-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=accettato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Accetta tutto</button>
    <button id="onetrust-reject-all-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=rifiutato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Rifiuta tutto</button>
  </div>
  <script>
    document.cookie = 'sessione=utente; path=/; max-age=86400';
    if (document.cookie.includes('OptanonConsent=')) document.getElementById('onetrust-banner-sdk').remove();
  </script>`;

test('menu della scheda: «Cookie non necessari rifiutati», e «Mostra il banner dei cookie» lo riporta (e si torna indietro)', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, RICORDA);
  await page.waitForFunction(() => !document.getElementById('onetrust-banner-sdk'), null, { timeout: 8_000 });

  const menu = await openAndRead(app, () => rightClickTab(shell), 'Cookie non necessari rifiutati');
  expect(menu).toContain('Mostra il banner dei cookie');

  await clickUntil(app, {
    open: () => rightClickTab(shell),
    needle: 'Mostra il banner dei cookie', labelRe: 'Mostra il banner dei cookie',
    until: async () => (await tabCookies(shell))?.shown === true,
  });
  // Dopo il ricaricamento il banner c'è e resta: il sito ha dimenticato la risposta, Filo non la ridà.
  await expect.poll(() => page.evaluate(() => !!document.getElementById('onetrust-banner-sdk')).catch(() => false), { timeout: 10_000 }).toBe(true);
  await sleep(2000);
  expect(await page.evaluate(() => !!document.getElementById('onetrust-banner-sdk'))).toBe(true);
  expect(await page.evaluate(() => document.cookie)).toContain('sessione=utente');

  const sites = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.bannerSites);
  expect(sites).toEqual(['127.0.0.1']);
  // L'utente, col banner davanti, accetta. Tornando all'automatico Filo deve rifiutare lo stesso.
  await page.click('#onetrust-accept-btn-handler');
  expect(await page.evaluate(() => document.cookie)).toContain('OptanonConsent=accettato');

  const menu2 = await openAndRead(app, () => rightClickTab(shell), 'Rifiuta i cookie in automatico qui');
  expect(menu2).not.toContain('Cookie non necessari rifiutati');
  await clickUntil(app, {
    open: () => rightClickTab(shell),
    needle: 'Rifiuta i cookie in automatico qui', labelRe: 'Rifiuta i cookie in automatico qui',
    until: async () => (await tabCookies(shell))?.shown === false,
  });
  await expect.poll(() => page.evaluate(() => document.cookie).catch(() => ''), { timeout: 10_000 }).toContain('OptanonConsent=rifiutato');
  expect(await page.evaluate(() => !!document.getElementById('onetrust-banner-sdk'))).toBe(false);
  expect(await page.evaluate(() => document.cookie)).toContain('sessione=utente');
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
});

test('Sicurezza: il sito coi banner compare nell\'elenco, anche a pagina già aperta, e si toglie', async ({ app, openTab }) => {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 8_000 });
  await expect(sec.locator('#sec-cookies-banners')).toBeHidden();
  await app.evaluate(async () => {
    await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { bannerSites: ['esempio.it'] } } });
  });
  await expect(sec.locator('#cookie-banners-list li')).toHaveText([/esempio\.it/], { timeout: 6_000 });
  await sec.locator('#cookie-banners-list button').click();
  await expect(sec.locator('#sec-cookies-banners')).toBeHidden();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.bannerSites), { timeout: 6_000 }).toEqual([]);
});

// ── il sito ricorda il rifiuto: il segno e «Mostra il banner» restano per il sito, non per la scheda ────────

async function aspettaChiusa(page) {
  await expect.poll(() => page.isClosed(), { timeout: 8_000 }).toBe(true);
}

test('in una scheda nuova dello stesso sito, senza più il banner, il menu dice ancora cosa è successo e offre di rivederlo', async ({ app, shell, openTab, testServer }) => {
  const a = await testServer.openReady(openTab, RICORDA);
  await a.waitForFunction(() => document.cookie.includes('OptanonConsent=rifiutato'), null, { timeout: 8_000 });
  const { activeId } = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  await shell.evaluate((id) => window.filoShell.tabs.close(id), activeId);
  await aspettaChiusa(a);

  const b = await testServer.openReady(openTab, RICORDA);
  await sleep(1500);
  // Il sito si ricorda il rifiuto e il banner non compare: proprio per questo è il menu che deve dirlo.
  expect(await b.evaluate(() => !!document.getElementById('onetrust-banner-sdk'))).toBe(false);
  const menu = await openAndRead(app, () => rightClickTab(shell), 'Cookie non necessari rifiutati');
  expect(menu).toContain('Mostra il banner dei cookie');
});

test('dopo aver riaperto Filo il menu della scheda offre ancora «Mostra il banner dei cookie» sul sito rifiutato', async ({ testServer }) => {
  test.setTimeout(90_000);
  const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const userData = cartellaTemporanea('filo-test-');
  const avvia = async () => {
    const app = await electron.launch({
      args: [...argomentiScala, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    const open = async (url) => {
      await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
      let page = null;
      await expect.poll(() => { page = app.windows().find((w) => w.url() === url); return !!page; }, { timeout: 10_000 }).toBe(true);
      await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
      return page;
    };
    return { app, shell, open };
  };
  const url = testServer.html(RICORDA);
  try {
    let run = await avvia();
    try {
      const a = await run.open(url);
      await a.waitForFunction(() => document.cookie.includes('OptanonConsent=rifiutato'), null, { timeout: 8_000 });
      await openAndRead(run.app, () => rightClickTab(run.shell), 'Cookie non necessari rifiutati');
      await run.app.evaluate(async ({ session }) => { await session.defaultSession.cookies.flushStore(); });
      await sleep(1200);
    } finally {
      await chiudiApp(run.app);
    }
    run = await avvia();
    try {
      const b = await run.open(url);
      await sleep(1500);
      expect(await b.evaluate(() => !!document.getElementById('onetrust-banner-sdk'))).toBe(false);
      const menu = await openAndRead(run.app, () => rightClickTab(run.shell), 'Cookie non necessari rifiutati');
      expect(menu).toContain('Mostra il banner dei cookie');
    } finally {
      await chiudiApp(run.app);
    }
  } finally {
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── banner senza «rifiuta» dentro un riquadro (Sourcepoint «accetta o abbonati») ─────────────────────────

// Righe vere di EasyList Cookie: la lista non nomina il contenitore di Sourcepoint, se non sito per sito.
const ESTRATTO_EASYLIST_COOKIE = [
  '###cookie-banner',
  '###didomi-notice',
  '##.qc-cmp2-container',
  'kooora.com##div[id^="sp_message_container_"]',
].join('\n');

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

test('banner «accetta o abbonati» dentro un riquadro (forma Sourcepoint): nascosto, la pagina scorre, niente accettato', async ({ app, openTab, testServer, shell }) => {
  await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), ESTRATTO_EASYLIST_COOKIE);
  const page = await testServer.openReady(openTab, `<title>SP_PAY_TOP</title>
    <style>html.sp-message-open{overflow:hidden!important} body{height:4000px;margin:0}</style>
    <div id="sp_message_container_1"
      style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483647;display:flex;align-items:center;justify-content:center">
      <iframe id="sp_message_iframe_1" src="${spAbbonatiFrame(testServer)}" style="width:560px;height:300px;border:0;background:#fff"></iframe>
    </div>
    <h1>Articolo</h1><p>contenuto</p>
    <script>
      document.documentElement.classList.add('sp-message-open');
      addEventListener('message', (e) => {
        if (typeof e.data !== 'string' || !e.data.startsWith('sp:')) return;
        window.__sp = e.data;
        if (e.data === 'sp:accept') document.cookie = 'tracking=1; path=/';
      });
    </script>`);
  await expect.poll(() => page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return !!el && !el.closest('#sp_message_container_1');
  }).catch(() => false), { timeout: 15_000 }).toBe(true);
  await page.mouse.move(200, 200);
  await expect.poll(async () => {
    await page.mouse.wheel(0, 400);
    return page.evaluate(() => window.scrollY);
  }, { timeout: 8_000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__sp)).toBeUndefined();
  expect(await page.evaluate(() => document.cookie)).not.toContain('tracking');
  await expect.poll(async () => (await tabCookies(shell))?.hidden, { timeout: 8_000 }).toBe(true);
});

test('un riquadro nel flusso della pagina col suo banner senza «rifiuta» resta: è contenuto, non un velo (controprova)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<title>WIDGET</title>
    <h1>Prenota un tavolo</h1>
    <iframe id="widget" src="${spAbbonatiFrame(testServer)}" style="width:560px;height:300px;border:1px solid #ccc"></iframe>
    <p>contenuto</p>`);
  await sleep(7000);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('widget')).display)).not.toBe('none');
  expect(await page.evaluate(() => document.getElementById('widget').getBoundingClientRect().height)).toBeGreaterThan(100);
});

test('banner «accetta o abbonati» che la lista non nomina ma le regole riconoscono (forma contentpass): nascosto, la pagina scorre', async ({ app, openTab, testServer, shell }) => {
  await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), ESTRATTO_EASYLIST_COOKIE);
  const page = await testServer.openReady(openTab, `<title>CP_WALL</title>
    <style>html,body{overflow:hidden} body{height:4000px;margin:0}</style>
    <div class="privacy-cp-wall" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center">
      <div class="privacy-cp-wall__wrapper_cmp" style="background:#fff;padding:24px;width:520px">
        <p>Per continuare a leggere accetta i cookie di profilazione, oppure abbonati.</p>
        <button onclick="document.cookie='tracking=1; path=/';window.__accepted=true">Accetta e continua</button>
        <button onclick="window.__subscribe=true">Abbonati</button>
      </div>
    </div>
    <h1>Articolo</h1><p>contenuto</p>`);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.privacy-cp-wall')).display), { timeout: 15_000 }).toBe('none');
  await page.mouse.move(200, 200);
  await expect.poll(async () => {
    await page.mouse.wheel(0, 400);
    return page.evaluate(() => window.scrollY);
  }, { timeout: 8_000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => [window.__accepted, window.__subscribe])).toEqual([undefined, undefined]);
  expect(await page.evaluate(() => document.cookie)).not.toContain('tracking');
  await expect.poll(async () => (await tabCookies(shell))?.hidden, { timeout: 8_000 }).toBe(true);
});

// ── incognito: i comandi sui cookie restano nell'incognito ─────────────────────────────────────────

async function consensoNormale(app) {
  return app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ name: 'OptanonConsent' })).map((c) => c.value));
}

test('«Mostra il banner dei cookie» in incognito lascia com\'è il profilo normale, anche a incognito chiuso', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html(RICORDA);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => consensoNormale(app), { timeout: 10_000 }).toEqual(['rifiutato']);
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);

  await shell.evaluate(() => window.filoShell.openIncognito());
  let incog = null;
  await expect.poll(() => { incog = app.windows().find((w) => w.url().includes('incognito=1')); return !!incog; }, { timeout: 10_000 }).toBe(true);
  await incog.waitForFunction(() => document.documentElement.dataset.incognito === '1', null, { timeout: 10_000 });
  await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(u), url);
  const statoIncognito = () => incog.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === snap.activeId);
    return t ? { id: t.id, cookies: t.cookies } : null;
  });
  await expect.poll(async () => (await statoIncognito())?.cookies?.rejected, { timeout: 10_000 }).toBe(true);
  const { id } = await statoIncognito();
  expect((await incog.evaluate((tid) => window.filoShell.tabs.cookieBanners(tid, true), id))?.ok).toBe(true);
  // Nell'incognito la scelta vale: il menu offre di tornare all'automatico.
  await expect.poll(async () => (await statoIncognito())?.cookies?.shown, { timeout: 8_000 }).toBe(true);
  await sleep(1500);
  expect(await consensoNormale(app)).toEqual(['rifiutato']);
  expect(await tabCookies(shell)).toEqual({ rejected: true, hidden: false, shown: false });

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito).close());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito)), { timeout: 10_000 }).toBe(false);
  expect(await tabCookies(shell)).toEqual({ rejected: true, hidden: false, shown: false });
  expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.bannerSites || [])).toEqual([]);
});

// ── messaggi dei CMP che non parlano di cookie: non sono banner da nascondere ──────────────────────

function spMessaggio(testServer, testo, bottoni) {
  return testServer.html(`<title>SP_MSG</title><style>body{margin:0;font:14px sans-serif}</style>
    <div class="message-container"><div id="notice" class="message type-modal" style="padding:20px">
      <div class="message-component message-row"><p class="message-component">${testo}</p></div>
      <div class="message-component message-row">${bottoni.map((b) =>
        `<button class="message-component message-button no-children focusable sp_choice_type_9" title="${b}">${b}</button>`).join('')}</div>
    </div></div>`).replace('127.0.0.1', 'blocked.test');
}

for (const [nome, testo, bottoni] of [
  ['avviso adblock', 'Sembra che tu stia usando un adblocker. Disattivalo per sostenere il nostro giornalismo.', ['Ho disattivato l\'adblocker', 'Abbonati']],
  ['articoli gratuiti finiti', 'Hai letto i 5 articoli gratuiti di questo mese. Abbonati per continuare a leggere.', ['Abbonati', 'Accedi']],
]) {
  test(`messaggio Sourcepoint che non parla di cookie (${nome}): resta, e il menu non dice «Banner dei cookie nascosto»`, async ({ openTab, testServer, shell }) => {
    const page = await testServer.openReady(openTab, `<title>SP_ALTRO</title>
      <style>body{height:4000px;margin:0}</style>
      <div id="sp_message_container_1" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483647;display:flex;align-items:center;justify-content:center">
        <iframe id="sp_message_iframe_1" src="${spMessaggio(testServer, testo, bottoni)}" style="width:560px;height:300px;border:0;background:#fff"></iframe>
      </div><h1>Articolo</h1>`);
    await sleep(9000);
    expect(await page.evaluate(() => {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return !!el && !!el.closest('#sp_message_container_1');
    })).toBe(true);
    expect((await tabCookies(shell))?.hidden).not.toBe(true);
  });
}

// ── sblocco: solo il blocco del banner, non il disegno del sito ───────────────────────────────────

test('applicazione col corpo fermo per disegno: nascosto il banner, la rotella non porta via l\'applicazione', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-notice'));
  const page = await testServer.openReady(openTab, `<!doctype html><title>APP</title>
    <style>html,body{margin:0;height:100%;overflow:hidden} .shell{display:flex;height:100%} nav{width:200px;background:#eee}
      main{flex:1;overflow:auto} .tall{height:3000px} .drawer{position:absolute;top:100%;left:0;width:300px;height:600px;background:#ccc}</style>
    <div class="shell"><nav>menu dell'applicazione</nav><main><div class="tall">contenuto</div></main></div>
    <div class="drawer">pannello a scomparsa</div>
    <div id="cookie-notice" style="position:fixed;bottom:0;left:0;right:0;height:80px;background:#fff">Usiamo i cookie. <button>OK</button></div>`);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 10_000 });
  await sleep(4500);
  await page.mouse.move(100, 100);
  await page.mouse.wheel(0, 500);
  await sleep(600);
  expect(await page.evaluate(() => document.scrollingElement.scrollTop)).toBe(0);
  // Il pannello dell'applicazione scorre ancora da sé.
  await page.mouse.move(600, 200);
  await expect.poll(async () => {
    await page.mouse.wheel(0, 300);
    return page.evaluate(() => document.querySelector('main').scrollTop);
  }, { timeout: 5_000 }).toBeGreaterThan(0);
});
