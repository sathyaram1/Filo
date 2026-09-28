// #754 giro 2, esplorazione: banner comuni in Italia con la lista EasyList Cookie vera, menu della scheda.
import { test as base, _electron as electron, expect } from '@playwright/test';
import { rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LISTA_DIR = process.env.LISTA_DIR || '';
const LISTA = LISTA_DIR && existsSync(LISTA_DIR)
  ? ['easylist_cookie_general_hide.txt', 'easylist_cookie_specific_hide.txt', 'easylist_cookie_international_specific_hide.txt', 'easylist_cookie_allowlist_general_hide.txt']
    .map((f) => readFileSync(join(LISTA_DIR, f), 'utf8')).join('\n')
  : '';

const test = base.extend({
  srv: async ({}, use) => {
    const pages = new Map();
    let port = 0;
    const server = createServer((req, res) => {
      const host = String(req.headers.host || '').split(':')[0];
      const p = req.url.split('?')[0];
      const body = pages.get(host + p);
      if (body == null) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    await use({
      put(host, p, html) { pages.set(host + p, html); return `http://${host}:${port}${p}`; },
      url(host, p) { return `http://${host}:${port}${p}`; },
    });
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  },
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-test-');
    const app = await electron.launch({
      args: [...argomentiScala, '--host-resolver-rules=MAP *.test 127.0.0.1', '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
  shell: async ({ app }, use) => {
    const w = await app.firstWindow();
    await w.waitForLoadState('domcontentloaded');
    await use(w);
  },
  open: async ({ app, shell }, use) => {
    await use(async (url) => {
      const host = new URL(url).hostname;
      await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
      let page = null;
      await expect.poll(() => { page = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } }); return !!page; }, { timeout: 10_000 }).toBe(true);
      await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
      return page;
    });
  },
});

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
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
  });
}

async function menuWin(app, needle) {
  for (const w of app.windows()) {
    try { if (await w.evaluate((n) => !!document.body && document.body.innerText.includes(n), needle)) return w; } catch (_) {}
  }
  return null;
}

async function openMenu(app, shell, needle) {
  let w = null;
  await expect.poll(async () => {
    w = await menuWin(app, needle);
    if (w) return true;
    await rightClickTab(shell);
    await sleep(300);
    w = await menuWin(app, needle);
    return !!w;
  }, { timeout: 15_000 }).toBe(true);
  return w;
}

async function clickMenu(app, shell, label) {
  const w = await openMenu(app, shell, label);
  await w.evaluate((l) => { [...document.querySelectorAll('button.item')].find((b) => b.textContent.includes(l)).click(); }, label);
}


function spFrame(inner) {
  return `<!doctype html><html><head><style>body{margin:0;font:14px sans-serif}</style></head><body>
<div class="message-container"><div id="notice" class="message type-modal">${inner}</div></div></body></html>`;
}
const SP_RIFIUTA = `<div class="message-component message-row"><p class="message-component">Cookie per la pubblicità.</p></div>
<div class="message-component message-row">
<button title="Accetta" class="message-component message-button no-children focusable sp_choice_type_11" onclick="top.postMessage('sp:accept','*')">Accetta</button>
<button title="Rifiuta" class="message-component message-button no-children focusable sp_choice_type_13" onclick="top.postMessage('sp:reject','*')">Rifiuta</button></div>`;

test('riquadro nel riquadro (forma Sourcepoint vera): il «Rifiuta» si preme', async ({ shell, open, srv }) => {
  srv.put('cmp.test', '/msg', spFrame(SP_RIFIUTA));
  srv.put('wrap.test', '/w', `<!doctype html><body style="margin:0"><iframe src="${srv.url('cmp.test', '/msg')}" style="width:500px;height:260px;border:0"></iframe></body>`);
  const page = await open(srv.put('quotidiano.test', '/a', `<!doctype html><title>Q</title><body>
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9;display:flex;align-items:center;justify-content:center" id="velo">
      <iframe src="${srv.url('wrap.test', '/w')}" style="width:520px;height:280px;border:0;background:#fff"></iframe></div>
    <script>addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.startsWith('sp:')) { window.__sp = e.data; document.getElementById('velo').remove(); } });</script></body>`));
  await expect.poll(() => page.evaluate(() => window.__sp || null), { timeout: 15_000 }).toBe('sp:reject');
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
});

const SP_TOP = (frame) => `<!doctype html><html class="sp-message-open"><head><title>QUOTIDIANO</title>
<style>html.sp-message-open{overflow:hidden!important} body{height:4000px;margin:0}
#sp_message_container_1{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center}
#sp_message_iframe_1{width:600px;height:300px;border:0;background:#fff}</style></head>
<body><h1>Articolo</h1><p>Il testo dell'articolo.</p>
<div id="sp_message_container_1"><iframe id="sp_message_iframe_1" title="SP Consent Message" src="${frame}"></iframe></div>
<script>window.__log=[];addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.startsWith('sp:')) window.__log.push(e.data); });</script></body></html>`;

async function coperta(page) {
  return page.evaluate(() => { const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return !!el && !!el.closest('#sp_message_container_1'); }).catch(() => true);
}

test('Sourcepoint «Accetta / Personalizza» in un riquadro (lista vera): nascosto, niente accettato', async ({ app, shell, open, srv }) => {
  test.skip(!LISTA, 'lista non disponibile');
  await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), LISTA);
  srv.put('cdn.privacy-mgmt.test', '/pers', spFrame(`<div class="message-component message-row"><p class="message-component">Noi e i nostri partner usiamo cookie.</p></div>
<div class="message-component message-row">
<button title="Personalizza" class="message-component message-button no-children focusable sp_choice_type_12" onclick="top.postMessage('sp:settings','*')">Personalizza</button>
<button title="Accetta" class="message-component message-button no-children focusable sp_choice_type_11" onclick="top.postMessage('sp:accept','*')">Accetta</button></div>`));
  const page = await open(srv.put('quotidiano.test', '/p', SP_TOP(srv.url('cdn.privacy-mgmt.test', '/pers'))));
  await expect.poll(() => coperta(page), { timeout: 15_000 }).toBe(false);
  console.log('LOG pers', await page.evaluate(() => window.__log.join(',')), JSON.stringify(await tabCookies(shell)));
  expect(await page.evaluate(() => window.__log.includes('sp:accept'))).toBe(false);
});

test('messaggio Sourcepoint che non parla di cookie (avviso adblock): cosa fa Filo', async ({ shell, open, srv }) => {
  srv.put('cdn.privacy-mgmt.test', '/adb', spFrame(`<div class="message-component message-row"><p class="message-component">Sembra che tu stia usando un adblocker. Disattivalo per sostenere il nostro giornalismo, oppure abbonati.</p></div>
<div class="message-component message-row">
<button title="Ho disattivato l'adblocker" class="message-component message-button no-children focusable sp_choice_type_9" onclick="top.postMessage('sp:ricarica','*')">Ho disattivato l'adblocker</button>
<button title="Abbonati" class="message-component message-button no-children focusable sp_choice_type_9" onclick="top.postMessage('sp:abbonati','*')">Abbonati</button></div>`));
  const page = await open(srv.put('quotidiano.test', '/adb', SP_TOP(srv.url('cdn.privacy-mgmt.test', '/adb'))));
  await sleep(9000);
  console.log('ADB coperta', await coperta(page), JSON.stringify(await tabCookies(shell)));
});

test('sito che per disegno scorre dentro un suo riquadro (body fermo): dopo aver nascosto il banner la pagina resta ferma', async ({ app, open, srv }) => {
  await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), '###cookie-notice');
  const page = await open(srv.put('app.test', '/', `<!doctype html><title>APP</title>
    <style>html,body{margin:0;height:100%;overflow:hidden} .shell{display:flex;height:100%} nav{width:200px;background:#eee} main{flex:1;overflow:auto} .tall{height:3000px}
    .drawer{position:absolute;top:100%;left:0;width:300px;height:600px;background:#ccc}</style>
    <div class="shell"><nav>menu</nav><main><div class="tall">contenuto dell'app</div></main></div>
    <div class="drawer">pannello fuori schermo</div>
    <div id="cookie-notice" style="position:fixed;bottom:0;left:0;right:0;height:80px;background:#fff">Usiamo i cookie. <button>OK</button></div>`));
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 10_000 });
  await sleep(4500);
  await page.mouse.move(100, 100);
  await page.mouse.wheel(0, 500);
  await sleep(500);
  console.log('APP scroll', await page.evaluate(() => [document.scrollingElement.scrollTop, getComputedStyle(document.body).overflowY, getComputedStyle(document.documentElement).overflowY]));
});

test('pagina inchiodata col body fisso e sfocata: dopo il banner nascosto scorre e la posizione torna', async ({ app, open, srv }) => {
  await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), '###cookie-notice');
  const page = await open(srv.put('lock.test', '/', `<!doctype html><title>LOCK</title>
    <style>body{margin:0} .c{height:4000px;background:linear-gradient(#fff,#999)}</style>
    <div class="c">contenuto</div>
    <div class="backdrop" style="position:fixed;inset:0;backdrop-filter:blur(4px);z-index:50"></div>
    <div id="cookie-notice" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#fff;z-index:51">Usiamo i cookie. <button>Accetta</button></div>
    <script>document.body.style.position='fixed';document.body.style.top='-300px';document.body.style.width='100%';</script>`));
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 10_000 });
  await sleep(1000);
  await page.mouse.move(100, 100);
  await page.mouse.wheel(0, 500);
  await sleep(500);
  console.log('LOCK', await page.evaluate(() => [window.scrollY, getComputedStyle(document.querySelector('.backdrop')).display, getComputedStyle(document.body).position]));
});

test('Privacy massima: il banner senza «rifiuta» si nasconde e il segno c\'è', async ({ app, shell, open, srv }) => {
  await app.evaluate(async () => { await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { mode: 'privacy' } } }); });
  await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), '###cookie-notice');
  const page = await open(srv.put('priv.test', '/', `<!doctype html><title>PRIV</title><div id="cookie-notice" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#fff">Usiamo i cookie. <button>Accetta</button></div>`));
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 10_000 });
  await expect.poll(async () => (await tabCookies(shell))?.hidden, { timeout: 8_000 }).toBe(true);
});
