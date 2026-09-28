// Esplorazione del giro 1 di #754 (si cancella prima della registrazione).
import { test as base, _electron as electron, expect } from '@playwright/test';
import { rmSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EC_DIR = process.env.EC_DIR || '';
function realList() {
  if (!EC_DIR) return '';
  return ['ec.txt', 'easylist_cookie_specific_hide.txt', 'easylist_cookie_international_specific_hide.txt', 'easylist_cookie_allowlist_general_hide.txt']
    .map((f) => (existsSync(join(EC_DIR, f)) ? readFileSync(join(EC_DIR, f), 'utf8') : '')).join('\n');
}

const test = base.extend({
  srv: async ({}, use) => {
    const pages = new Map();
    const hits = [];
    const server = createServer((req, res) => {
      const host = String(req.headers.host || '').split(':')[0];
      const key = host + req.url.split('?')[0];
      hits.push(key);
      const body = pages.get(key);
      if (body == null) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    await use({
      port, hits,
      set(host, path, html) { pages.set(host + path, html); return `http://${host}:${port}${path}`; },
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
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await use(win);
  },
  openTab: async ({ app, shell }, use) => {
    await use(async (url) => {
      const target = new URL(url).hostname;
      await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
      const deadline = Date.now() + 10_000;
      let page = null;
      while (Date.now() < deadline) {
        page = app.windows().find((w) => { try { return new URL(w.url()).hostname === target; } catch (_) { return false; } });
        if (page) break;
        await sleep(100);
      }
      if (!page) throw new Error('openTab: ' + url);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return page;
    });
  },
});

async function rightClickTab(shell) {
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
  });
}
async function readMenuOnce(app, needle) {
  for (const w of app.windows()) {
    try {
      const t = await w.evaluate((n) => (document.body && document.body.innerText.includes(n)) ? document.body.innerText : null, needle);
      if (t != null) return t;
    } catch (_) {}
  }
  return null;
}
async function menuText(app, shell, needle = 'Duplica') {
  let text = null;
  await expect.poll(async () => {
    text = await readMenuOnce(app, needle);
    if (text != null) return true;
    await rightClickTab(shell);
    await sleep(150);
    text = await readMenuOnce(app, needle);
    return text != null;
  }, { timeout: 15_000 }).toBe(true);
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
async function tabCookies(shell) {
  return shell.evaluate(async () => {
    const st = await window.filoShell.tabs.list?.();
    return st || null;
  }).catch(() => null);
}

// ─── pagine ────────────────────────────────────────────────────────────────

function spTop(frameUrl) {
  return `<!doctype html><html class="sp-message-open"><head><title>NEWS</title>
<style>html.sp-message-open{overflow:hidden!important} body{height:4000px;margin:0}
#sp_message_container_1{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center}
#sp_message_iframe_1{width:600px;height:300px;border:0;background:#fff}</style></head>
<body><h1>Articolo</h1><p>testo</p>
<div id="sp_message_container_1"><iframe id="sp_message_iframe_1" title="SP Consent Message" src="${frameUrl}"></iframe></div>
<script>
window.__log=[];
addEventListener('message',(e)=>{const d=e.data||{}; if(!d.sp) return; window.__log.push(d.sp);
 if(d.sp==='accept'){document.cookie='tracking_id=abc123; path=/';document.cookie='euconsent-v2=ALL; path=/';}
 if(d.sp==='reject'){document.cookie='consentUUID=rej; path=/';}
 if(d.sp==='subscribe'){location.href='/abbonati';return;}
 document.getElementById('sp_message_container_1').remove(); document.documentElement.classList.remove('sp-message-open');});
</script></body></html>`;
}

function spFrame(buttons) {
  const btn = (cls, txt, act) => `<button title="${txt}" aria-label="${txt}" class="message-component message-button no-children focusable ${cls}" onclick="parent.postMessage({sp:'${act}'},'*')">${txt}</button>`;
  return `<!doctype html><html><head><style>body{margin:0;font:14px sans-serif}</style></head><body>
<div class="message-container"><div id="notice" class="message type-modal">
<div class="message-component message-row"><p class="message-component">Usiamo i cookie per migliorare la tua esperienza.</p></div>
<div class="message-component message-row">${buttons.map((b) => btn(...b)).join('')}</div>
</div></div></body></html>`;
}

async function cookiesOf(app, host) {
  return app.evaluate(async ({ session }, h) => {
    const all = await session.defaultSession.cookies.get({});
    return all.filter((c) => String(c.domain).replace(/^\./, '') === h).map((c) => c.name + '=' + c.value);
  }, host);
}

test('SP italiano nel riquadro: Rifiuta premuto', async ({ app, shell, openTab, srv }) => {
  const frame = srv.set('cmp.privacy-mgmt.test', '/sp', spFrame([['sp_choice_type_11', 'Accetta', 'accept'], ['sp_choice_type_13', 'Rifiuta', 'reject']]));
  const url = srv.set('news-it.test', '/a', spTop(frame));
  const page = await openTab(url);
  await expect.poll(() => page.evaluate(() => window.__log.join(',')).catch(() => ''), { timeout: 15_000 }).toBe('reject');
  expect((await cookiesOf(app, 'news-it.test')).join(';')).not.toContain('tracking_id');
  const scroll = await page.evaluate(() => { window.scrollTo(0, 500); return window.scrollY; });
  expect(scroll).toBeGreaterThan(0);
  const t = await menuText(app, shell);
  console.log('MENU SP IT:', JSON.stringify(t));
  expect(t).toContain('Cookie non necessari rifiutati');
});

test('SP inglese nel riquadro: Reject All premuto', async ({ app, shell, openTab, srv }) => {
  const frame = srv.set('cmp.privacy-mgmt.test', '/spen', spFrame([['sp_choice_type_11', 'Accept All', 'accept'], ['sp_choice_type_13', 'Reject All', 'reject']]));
  const url = srv.set('news-en.test', '/a', spTop(frame));
  const page = await openTab(url);
  await expect.poll(() => page.evaluate(() => window.__log.join(',')).catch(() => ''), { timeout: 15_000 }).toBe('reject');
});

test('SP nel riquadro senza rifiuta (accetta o abbonati): nascosto, pagina sbloccata', async ({ app, shell, openTab, srv }) => {
  const list = realList();
  if (list) await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), list);
  const frame = srv.set('cmp.privacy-mgmt.test', '/sppay', spFrame([['sp_choice_type_11', 'Accetta e continua', 'accept'], ['sp_choice_type_9', 'Abbonati', 'subscribe']]));
  const url = srv.set('news-pay.test', '/a', spTop(frame));
  const page = await openTab(url);
  await sleep(9000);
  const st = await page.evaluate(() => {
    const c = document.getElementById('sp_message_container_1');
    window.scrollTo(0, 500);
    return { log: window.__log.join(','), container: c ? getComputedStyle(c).display : 'gone', scrollY: window.scrollY, htmlOverflow: getComputedStyle(document.documentElement).overflowY };
  });
  console.log('SP PAY:', JSON.stringify(st), 'list?', !!list);
  expect(st.log).toBe('');
  expect((await cookiesOf(app, 'news-pay.test')).join(';')).not.toContain('tracking_id');
  expect(st.container).toBe('none');
  expect(st.scrollY).toBeGreaterThan(0);
});

test('banner solo Accetta nella pagina: nascosto, scorre, niente cookie', async ({ app, shell, openTab, srv }) => {
  const list = realList();
  if (list) await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), list);
  const url = srv.set('shop.test', '/a', `<!doctype html><html><head><title>SHOP</title><style>body{height:4000px;overflow:hidden}
.veil{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999}
#cookie-notice{position:fixed;bottom:0;left:0;right:0;z-index:1000;background:#fff;padding:20px}</style></head><body>
<h1>Negozio</h1><div class="veil"></div>
<div id="cookie-notice">Questo sito usa i cookie. <button onclick="document.cookie='tracking_id=x; path=/';this.parentNode.remove()">Accetta</button></div>
</body></html>`);
  const page = await openTab(url);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('cookie-notice')).display).catch(() => ''), { timeout: 15_000 }).toBe('none');
  await sleep(1600);
  const st = await page.evaluate(() => { window.scrollTo(0, 500); return { y: window.scrollY, veil: getComputedStyle(document.querySelector('.veil')).display }; });
  console.log('ACCEPT ONLY:', JSON.stringify(st));
  expect(st.y).toBeGreaterThan(0);
  expect(st.veil).toBe('none');
  expect((await cookiesOf(app, 'shop.test')).join(';')).not.toContain('tracking_id');
  const t = await menuText(app, shell);
  console.log('MENU HIDDEN:', JSON.stringify(t));
  expect(t).toContain('Banner dei cookie nascosto');
});
