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


async function snap(shell) { return shell.evaluate(() => window.filoShell.tabs.snapshot()); }
async function wheelScroll(page) {
  await page.mouse.move(300, 300);
  await page.mouse.wheel(0, 600);
  await sleep(500);
  return page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
}

test('rivisita in una scheda nuova: il segno resta?', async ({ app, shell, openTab, srv }) => {
  const frame = srv.set('cmp.privacy-mgmt.test', '/sp2', spFrame([['sp_choice_type_11', 'Accetta', 'accept'], ['sp_choice_type_13', 'Rifiuta', 'reject']]));
  const pageHtml = (id) => `<!doctype html><html><head><title>${id}</title></head><body><h1>x</h1><script>
  window.__log=[];
  addEventListener('message',(e)=>{const d=e.data||{}; if(!d.sp) return; window.__log.push(d.sp); if(d.sp==='reject'){document.cookie='consentUUID=rej; path=/';} document.getElementById('sp_message_container_1')?.remove();});
  if(!document.cookie.includes('consentUUID')) document.write('<div id="sp_message_container_1"><iframe id="sp_message_iframe_1" src="${frame}" style="width:600px;height:300px"></iframe></div>');
  </script></body></html>`;
  const url = srv.set('news-rev.test', '/a', pageHtml('A'));
  const url2 = srv.set('news-rev.test', '/b', pageHtml('B'));
  const page = await openTab(url);
  await expect.poll(() => page.evaluate(() => window.__log.join(',')).catch(() => ''), { timeout: 15_000 }).toBe('reject');
  let s = await snap(shell);
  const a = s.tabs.find((t) => /news-rev/.test(t.url));
  console.log('TAB A cookies:', JSON.stringify(a.cookies));
  await shell.evaluate((id) => window.filoShell.tabs.close(id), a.id);
  await sleep(500);
  const p2 = await openTab(url2);
  await sleep(4000);
  const has = await p2.evaluate(() => !!document.getElementById('sp_message_container_1'));
  s = await snap(shell);
  const b = s.tabs.find((t) => /news-rev/.test(t.url));
  console.log('TAB B banner?', has, 'cookies:', JSON.stringify(b && b.cookies), 'active', s.activeId === (b && b.id));
  const t2 = await menuText(app, shell);
  console.log('MENU B:', JSON.stringify(t2));
  expect(t2).toContain('Mostra il banner dei cookie');
});

test('SP nel riquadro senza rifiuta: resta sopra e la pagina non scorre', async ({ app, shell, openTab, srv }) => {
  const list = realList();
  await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), list);
  const frame = srv.set('cmp.privacy-mgmt.test', '/sppay', spFrame([['sp_choice_type_11', 'Accetta e continua', 'accept'], ['sp_choice_type_9', 'Abbonati', 'subscribe']]));
  const url = srv.set('news-pay.test', '/a', spTop(frame));
  const page = await openTab(url);
  await sleep(9000);
  const y = await wheelScroll(page);
  const st = await page.evaluate(() => {
    const c = document.getElementById('sp_message_container_1');
    return { log: window.__log.join(','), container: c ? getComputedStyle(c).display : 'gone', htmlOverflow: getComputedStyle(document.documentElement).overflowY };
  });
  const s = await snap(shell);
  console.log('SP PAY:', JSON.stringify(st), 'wheelY', y, 'list lines', list.split('\n').length, 'tab', JSON.stringify(s.tabs.find((t) => /news-pay/.test(t.url)).cookies));
  expect(st.container).toBe('none');
});

test('banner solo Accetta: nascosto e la rotella scorre', async ({ app, shell, openTab, srv }) => {
  await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), realList());
  const url = srv.set('shop.test', '/a', `<!doctype html><html><head><title>SHOP</title><style>html,body{overflow:hidden} body{height:4000px}
.veil{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999}
#cookie-banner{position:fixed;bottom:0;left:0;right:0;z-index:1000;background:#fff;padding:20px}</style></head><body>
<h1>Negozio</h1><div class="veil"></div>
<div id="cookie-banner">Questo sito usa i cookie. <button onclick="document.cookie='tracking_id=x; path=/';this.parentNode.remove()">Accetta</button></div>
</body></html>`);
  const page = await openTab(url);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('cookie-banner')).display).catch(() => ''), { timeout: 15_000 }).toBe('none');
  await sleep(1800);
  const y = await wheelScroll(page);
  console.log('ACCEPT ONLY wheelY', y);
  expect(y).toBeGreaterThan(0);
  for (const theme of ['light', 'dark']) {
    await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, theme);
    await menuText(app, shell, 'Banner dei cookie nascosto');
    for (const w of app.windows()) {
      const ok = await w.evaluate(() => document.body && document.body.innerText.includes('Banner dei cookie nascosto')).catch(() => false);
      if (ok) { await w.screenshot({ path: `tests/.shots/v754-menu-${theme}.png` }).catch((e) => console.log('shot err', e.message)); break; }
    }
    await shell.keyboard.press('Escape').catch(() => {});
    await sleep(400);
  }
});

test('TCF: il rifiuto registrato dà il segno; pagina Sicurezza con un sito', async ({ app, shell, openTab, srv }) => {
  const url = srv.set('tcf.test', '/a', `<!doctype html><html><head><title>TCF</title></head><body><h1>x</h1>
<iframe name="__tcfapiLocator" style="display:none"></iframe>
<div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:20px;z-index:9">Cookie
<button id="onetrust-reject-all-handler" onclick="window.__c={1:false,2:false};this.parentNode.remove()">Rifiuta tutto</button>
<button id="onetrust-accept-btn-handler" onclick="window.__c={1:true,2:true};this.parentNode.remove()">Accetta</button></div>
<script>
window.__c={};
window.__tcfapi=function(cmd,v,cb){ if(cmd==='ping') cb({cmpLoaded:true,displayStatus:document.getElementById('onetrust-banner-sdk')?'visible':'hidden'},true); else if(cmd==='getTCData') cb({purpose:{consents:window.__c}},true); };
addEventListener('message',(e)=>{let d=e.data; if(typeof d==='string'){try{d=JSON.parse(d)}catch(_){return}} const c=d&&d.__tcfapiCall; if(!c) return; window.__tcfapi(c.command,c.version,(rv,ok)=>{ e.source.postMessage({__tcfapiReturn:{returnValue:rv,success:ok,callId:c.callId}},'*'); }, c.parameter); });
</script></body></html>`);
  const page = await openTab(url);
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.__c)).catch(() => ''), { timeout: 15_000 }).toBe('{"1":false,"2":false}');
  await expect.poll(async () => { const s = await snap(shell); return JSON.stringify(s.tabs.find((t) => /tcf\.test/.test(t.url)).cookies); }, { timeout: 8000 }).toContain('"rejected":true');
  // «Mostra il banner» → la pagina Sicurezza lo elenca
  const s = await snap(shell);
  const tab = s.tabs.find((t) => /tcf\.test/.test(t.url));
  await shell.evaluate((id) => window.filoShell.tabs.cookieBanners(id, true), tab.id);
  await sleep(1500);
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#cookie-banners-list li', { timeout: 8000 });
  for (const theme of ['light', 'dark']) {
    await sec.evaluate((t) => window.SN_PAGE_BOOTSTRAP && window.SN_PAGE_BOOTSTRAP.applyTheme(t), theme).catch(() => {});
    await sec.locator('#sec-cookies').screenshot({ path: `tests/.shots/v754-security-${theme}.png` }).catch((e) => console.log('shot err', e.message));
  }
  console.log('SEC LIST:', await sec.locator('#sec-cookies-banners').innerText());
});
