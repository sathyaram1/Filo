// #754 giro 1, rilievo 2: un banner «accetta o abbonati» disegnato in un riquadro (forma Sourcepoint) va
// nascosto senza accettare, e la pagina deve tornare a scorrere. La lista EasyList Cookie vera non nomina il
// contenitore di Sourcepoint: qui se ne carica un estratto con le sue righe su Sourcepoint, com'è davvero.
import { test as base, _electron as electron, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Righe vere di easylist_cookie (general_hide e specific_hide), comprese le sole che parlano di Sourcepoint.
const ESTRATTO_EASYLIST_COOKIE = [
  '###cookie-banner',
  '###cookieBanner',
  '###didomi-notice',
  '###truste-consent-track',
  '##.qc-cmp2-container',
  '!! #sp_message_container',
  'kooora.com##div[id^="sp_message_container_"]',
  'aftenposten.no##div[id^="sp_message_"]',
].join('\n');

const FRAME = `<!doctype html><html><head><style>body{margin:0;font:14px sans-serif}</style></head><body>
<div class="message-container"><div id="notice" class="message type-modal">
<div class="message-component message-row"><p class="message-component">Usiamo i cookie e dati simili per mostrarti pubblicità personalizzata. Accetta, oppure abbonati per leggere senza.</p></div>
<div class="message-component message-row">
<button title="Accetta e continua" aria-label="Accetta e continua" class="message-component message-button no-children focusable sp_choice_type_11" onclick="parent.postMessage({sp:'accept'},'*')">Accetta e continua</button>
<button title="Abbonati" aria-label="Abbonati" class="message-component message-button no-children focusable sp_choice_type_9" onclick="parent.postMessage({sp:'subscribe'},'*')">Abbonati</button>
</div></div></div></body></html>`;

const TOP = (frameUrl) => `<!doctype html><html class="sp-message-open"><head><title>QUOTIDIANO</title>
<style>html.sp-message-open{overflow:hidden!important} body{height:4000px;margin:0}
#sp_message_container_1{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center}
#sp_message_iframe_1{width:600px;height:300px;border:0;background:#fff}</style></head>
<body><h1>Articolo</h1><p>Il testo dell'articolo.</p>
<div id="sp_message_container_1"><iframe id="sp_message_iframe_1" title="SP Consent Message" src="${frameUrl}"></iframe></div>
<script>
window.__log = [];
addEventListener('message', (e) => { const d = e.data || {}; if (!d.sp) return; window.__log.push(d.sp);
  if (d.sp === 'accept') { document.cookie = 'tracking_id=abc123; path=/'; document.cookie = 'euconsent-v2=ALL; path=/'; }
  if (d.sp === 'subscribe') { location.href = '/abbonati'; return; }
  document.getElementById('sp_message_container_1').remove(); document.documentElement.classList.remove('sp-message-open'); });
</script></body></html>`;

const test = base.extend({
  srv: async ({}, use) => {
    let port = 0;
    const server = createServer((req, res) => {
      const host = String(req.headers.host || '').split(':')[0];
      const path = req.url.split('?')[0];
      let body = null;
      if (host === 'cdn.privacy-mgmt.test' && path === '/index.html') body = FRAME;
      if (host === 'quotidiano.test' && path === '/articolo') body = TOP(`http://cdn.privacy-mgmt.test:${port}/index.html`);
      if (body == null) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    await use({ url: `http://quotidiano.test:${port}/articolo` });
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
});

test('Sourcepoint «accetta o abbonati» in un riquadro: nascosto, la pagina scorre, niente accettato', async ({ app, srv }) => {
  await app.evaluate((_e, txt) => globalThis.__filoCookieBanners.setListForTest(txt), ESTRATTO_EASYLIST_COOKIE);
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'quotidiano.test'; } catch (_) { return false; } }); return !!page; }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });

  // Il banner non si vede più: al centro della finestra c'è la pagina, non il velo col riquadro.
  await expect.poll(() => page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return !!el && !el.closest('#sp_message_container_1');
  }).catch(() => false), { timeout: 15_000 }).toBe(true);

  // La rotella scorre di nuovo.
  await sleep(1500);
  await page.mouse.move(200, 200);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop), { timeout: 5_000 }).toBeGreaterThan(0);

  // Niente è stato accettato: nessun clic sul riquadro e nessun cookie di tracciamento.
  expect(await page.evaluate(() => window.__log.join(','))).toBe('');
  const cookies = await app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({})).map((c) => c.name));
  expect(cookies).not.toContain('tracking_id');
});
