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

const CLI = `<!doctype html><html><head><title>BLOG</title><style>body{margin:0;font:16px sans-serif} .c{height:4000px}</style></head><body>
<div class="c"><h1>Ricette della nonna</h1><p>Testo del blog.</p></div>
<div id="cookie-law-info-bar" data-nosnippet="true" style="position:fixed;bottom:0;left:0;right:0;background:#fff;color:#333;padding:14px;box-shadow:0 -1px 10px rgba(0,0,0,.3);z-index:9999">
<span>Questo sito utilizza i cookie per migliorare la tua esperienza.
<a role="button" class="medium cli-plugin-button cli-plugin-main-button cli_settings_button" style="margin:0 5px">Impostazioni cookie</a>
<a role="button" data-cli_action="accept" id="cookie_action_close_header" class="medium cli-plugin-button cli-plugin-main-button cookie_action_close_header cli_action_button" onclick="document.cookie='viewed_cookie_policy=yes; path=/';document.cookie='_ga=GA1.1.1; path=/';window.__accepted=true">ACCETTA</a>
</span></div></body></html>`;

test('CookieLawInfo col solo ACCETTA (lista vera): nascosto, segno, «Mostra» lo riporta e l\'automatico lo rinasconde', async ({ app, shell, open, srv }) => {
  test.skip(!LISTA, 'lista non disponibile');
  test.setTimeout(120_000);
  await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), LISTA);
  const page = await open(srv.put('blog.test', '/ricetta', CLI));
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('cookie-law-info-bar')).display), { timeout: 10_000 }).toBe('none');
  expect(await page.evaluate(() => window.__accepted)).toBeUndefined();
  await expect.poll(async () => (await tabCookies(shell))?.hidden, { timeout: 8_000 }).toBe(true);
  const m = await openMenu(app, shell, 'Banner dei cookie nascosto');
  mkdirSync(SHOTS, { recursive: true });
  await m.screenshot({ path: join(SHOTS, '754-menu-nascosto.png') });
  await clickMenu(app, shell, 'Mostra il banner dei cookie');
  await expect.poll(async () => (await tabCookies(shell))?.shown, { timeout: 8_000 }).toBe(true);
  await sleep(4000);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('cookie-law-info-bar')).display)).not.toBe('none');
  const m2 = await openMenu(app, shell, 'Rifiuta i cookie in automatico qui');
  await m2.screenshot({ path: join(SHOTS, '754-menu-mostrato.png') });
  await clickMenu(app, shell, 'Rifiuta i cookie in automatico qui');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('cookie-law-info-bar')).display).catch(() => ''), { timeout: 12_000 }).toBe('none');
});

const IUBENDA = `<!doctype html><html><head><title>NEGOZIO</title></head><body style="margin:0;height:3000px">
<h1>Negozio</h1>
<div id="iubenda-cs-banner" class="iubenda-cs-default iubenda-cs-bottom" style="position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#1b1b1b;color:#fff;padding:14px">
 <div class="iubenda-cs-container"><div class="iubenda-cs-content">
  <button class="iubenda-cs-close-btn" style="float:right" onclick="window.__closed=true;document.getElementById('iubenda-cs-banner').remove()">×</button>
  <div id="iubenda-cs-title">Informativa</div>
  <div id="iubenda-cs-paragraph"><p>Noi e terze parti selezionate utilizziamo cookie per finalità tecniche e, con il tuo consenso, anche per altre finalità.</p></div>
  <div class="iubenda-cs-opt-group">
   <div class="iubenda-cs-opt-group-custom"><button class="iubenda-cs-customize-btn" onclick="document.getElementById('iubenda-iframe').style.display='block'">Scopri di più e personalizza</button></div>
   <div class="iubenda-cs-opt-group-consent"><button class="iubenda-cs-accept-btn iubenda-cs-btn-primary" onclick="window.__accepted=true;document.cookie='_iub_cs-1=all; path=/';document.getElementById('iubenda-cs-banner').remove()">Accetta</button></div>
  </div>
 </div></div>
</div>
<div id="iubenda-iframe" style="display:none;position:fixed;inset:10%;background:#fff;color:#000;z-index:100000;padding:20px">
 <div class="purposes-item"><label>Interazioni e funzionalità semplici</label><input type="checkbox" checked disabled></div>
 <div class="purposes-item"><label>Miglioramento dell’esperienza</label><input type="checkbox" checked></div>
 <div class="purposes-item"><label>Misurazione</label><input type="checkbox" checked></div>
 <div class="purposes-item"><label>Targeting e Pubblicità</label><input type="checkbox" checked></div>
 <button id="iubFooterBtn" onclick="window.__saved=[...document.querySelectorAll('.purposes-item input')].map(i=>i.checked);document.getElementById('iubenda-iframe').remove();document.getElementById('iubenda-cs-banner').remove()">Salva e continua</button>
</div></body></html>`;

test('iubenda con Accetta e Personalizza (senza «rifiuta»): le finalità si spengono e la scelta si salva', async ({ shell, open, srv }) => {
  const page = await open(srv.put('negozio.test', '/', IUBENDA));
  await page.waitForFunction(() => !document.getElementById('iubenda-cs-banner'), null, { timeout: 15_000 }).catch(() => {});
  const st = await page.evaluate(() => ({ saved: window.__saved, accepted: window.__accepted, closed: window.__closed, banner: !!document.getElementById('iubenda-cs-banner'), disp: document.getElementById('iubenda-cs-banner') && getComputedStyle(document.getElementById('iubenda-cs-banner')).display }));
  console.log('IUBENDA', JSON.stringify(st), JSON.stringify(await tabCookies(shell)));
  expect(st.accepted).toBeUndefined();
  expect(st.saved).toEqual([true, false, false, false]);
});

// Banner in un riquadro dentro un altro riquadro (una pubblicità che incorpora il CMP): il rifiuto arriva lo stesso.
test('riquadro nel riquadro: il «Rifiuta» del CMP si preme', async ({ shell, open, srv }) => {
  srv.put('cmp.test', '/msg', `<!doctype html><body><div class="message-container"><div class="message type-modal">
    <p>Cookie per la pubblicità</p>
    <button class="message-component message-button sp_choice_type_11" title="Accetta" onclick="top.postMessage('sp:accept','*')">Accetta</button>
    <button class="message-component message-button sp_choice_type_13" title="Rifiuta" onclick="top.postMessage('sp:reject','*')">Rifiuta</button>
  </div></div></body>`);
  srv.put('wrap.test', '/w', `<!doctype html><body style="margin:0"><iframe src="${srv.url('cmp.test', '/msg')}" style="width:500px;height:260px;border:0"></iframe></body>`);
  const page = await open(srv.put('quotidiano.test', '/a', `<!doctype html><title>Q</title><body>
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9;display:flex;align-items:center;justify-content:center" id="velo">
      <iframe src="${srv.url('wrap.test', '/w')}" style="width:520px;height:280px;border:0;background:#fff"></iframe></div>
    <script>addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.startsWith('sp:')) { window.__sp = e.data; document.getElementById('velo').remove(); } });</script></body>`));
  await expect.poll(() => page.evaluate(() => window.__sp || null), { timeout: 15_000 }).toBe('sp:reject');
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
});

// Didomi in un riquadro (variante incorporata): il rifiuto arriva come sulla pagina.
test('Didomi dentro un riquadro: «Rifiuta» premuto', async ({ shell, open, srv }) => {
  srv.put('cmp.test', '/didomi', `<!doctype html><body><div id="didomi-host"><div id="didomi-notice" class="didomi-popup-notice">
    <p>Noi e i nostri partner utilizziamo cookie.</p>
    <button id="didomi-notice-agree-button" onclick="top.postMessage('d:accept','*')">Accetta e chiudi</button>
    <button id="didomi-notice-disagree-button" onclick="top.postMessage('d:reject','*')">Continua senza accettare</button>
  </div></div></body>`);
  const page = await open(srv.put('rivista.test', '/a', `<!doctype html><title>R</title><body>
    <iframe id="f" src="${srv.url('cmp.test', '/didomi')}" style="position:fixed;bottom:0;left:0;width:100%;height:200px;border:0;background:#fff;z-index:9"></iframe>
    <script>addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.startsWith('d:')) { window.__d = e.data; document.getElementById('f').remove(); } });</script></body>`));
  await expect.poll(() => page.evaluate(() => window.__d || null), { timeout: 15_000 }).toBe('d:reject');
});

// Il cambio di modalità a pagina aperta arriva anche ai riquadri.
test('Manuale scelto a pagina aperta: il banner che compare dopo nel riquadro resta', async ({ app, shell, open, srv }) => {
  srv.put('cmp.test', '/tardi', `<!doctype html><body><script>
    addEventListener('message', (e) => { if (e.data !== 'mostra') return;
      document.body.insertAdjacentHTML('beforeend', '<div class="message-container"><div class="message type-modal"><button class="message-component message-button sp_choice_type_13" title="Rifiuta" onclick="top.postMessage(\\'sp:reject\\',\\'*\\')">Rifiuta</button></div></div>'); });
  </script></body>`);
  const page = await open(srv.put('giornale.test', '/a', `<!doctype html><title>G</title><body>
    <iframe id="f" src="${srv.url('cmp.test', '/tardi')}" style="width:500px;height:200px;border:0"></iframe>
    <script>addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.startsWith('sp:')) window.__sp = e.data; });</script></body>`));
  await sleep(1500);
  await app.evaluate(async () => { await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { mode: 'manual' } } }); });
  await sleep(1500);
  await page.evaluate(() => document.getElementById('f').contentWindow.postMessage('mostra', '*'));
  await sleep(4000);
  expect(await page.evaluate(() => window.__sp || null)).toBeNull();
});
