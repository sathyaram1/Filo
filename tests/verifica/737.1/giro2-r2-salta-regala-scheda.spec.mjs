// #737.1 giro 2 — il clic vero che Filo dà al «Salta» di un lettore incorporato non è un gesto del sito ospite.
// Fixture e lettore finto copiati da tests/ad-skip.spec.mjs (YouTube servito in locale con host-resolver-rules).

import { test as base, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const test = base.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-adskip-');
    const app = await electron.launch({
      args: [...argomentiScala, '--host-resolver-rules=MAP www.youtube.com 127.0.0.1, MAP www.youtube-nocookie.com 127.0.0.1, MAP sito-pubblico.test 127.0.0.1', '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

// Un lettore con la pubblicità in corso: il «Salta» compare dopo `dopoMs`, come dopo i cinque secondi di YouTube.
// Con `soloVeri` un clic fabbricato non salta niente, come su YouTube.
function lettore({ classe = 'ytp-skip-ad-button', soloVeri = true, dopoMs = 1200, campo = false, titolo = 'Lettore' } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${titolo}</title><style>
  body{margin:0;font:14px sans-serif}
  #movie_player{position:relative;width:640px;height:360px;background:#222;margin:20px}
  #slot{position:absolute;right:0;bottom:60px;display:none}
  #slot button{padding:10px 22px;font:16px sans-serif}
  </style></head><body>
  ${campo ? '<input id="cerca" placeholder="cerca">' : ''}
  <div id="movie_player" class="html5-video-player ad-showing">
    <video muted></video>
    <div id="slot"><button class="${classe}" id="salta">Salta</button></div>
  </div>
  <script>
    window.__clic = [];
    window.__saltata = false;
    document.getElementById('salta').addEventListener('click', (e) => {
      window.__clic.push({ vero: e.isTrusted, alle: Date.now() });
      if (${soloVeri ? '!e.isTrusted' : 'false'}) return;
      document.getElementById('movie_player').classList.remove('ad-showing');
      document.getElementById('slot').style.display = 'none';
      window.__saltata = true;
    });
    window.__mostra = () => { document.getElementById('slot').style.display = 'block'; window.__mostrataAlle = Date.now(); };
    ${dopoMs >= 0 ? `setTimeout(window.__mostra, ${dopoMs});` : ''}
  </script></body></html>`;
}

const stato = (page) => page.evaluate(() => ({
  clic: window.__clic, saltata: window.__saltata, mostrataAlle: window.__mostrataAlle || 0,
}));

const suYouTube = (url) => url.replace('127.0.0.1', 'www.youtube.com');

async function apri(openTab, url) {
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  return page;
}

function ospite(src, { sopra = false } = {}) {
  return `<!doctype html><title>Blog</title><body style="margin:8px"><p>articolo</p>
  <script>window.__gesti=[];['pointerdown','mousedown','click'].forEach((t)=>document.addEventListener(t,(e)=>{if(e.isTrusted)window.__gesti.push(t+':'+e.target.tagName);},true));</script>
  <div style="position:relative;width:724px;height:424px">
    <iframe id="yt" src="${src}" width="720" height="420"></iframe>
    ${sopra ? '<div id="sopra" style="position:absolute;inset:0;background:transparent"></div>' : ''}
  </div></body>`;
}

async function riquadro(page, url) {
  await expect.poll(() => page.frames().find((f) => f.url() === url) || null, { timeout: 5_000 }).not.toBeNull();
  return page.frames().find((f) => f.url() === url);
}


test('il «Salta» premuto da Filo nel lettore incorporato non regala una scheda al sito che lo ospita', async ({ app, openTab, testServer }) => {
  const bersaglio = testServer.html('<title>PUBBLICITA OSPITE</title>');
  const dentro = suYouTube(testServer.html(lettore({ dopoMs: -1 })));
  const html = ospite(dentro).replace('</body>', `<script>setInterval(function(){window.open(${JSON.stringify(bersaglio)})},300)</script></body>`);
  const page = await apri(openTab, testServer.html(html, { pubblico: true }));
  const frame = await riquadro(page, dentro);
  await frame.waitForFunction(() => typeof window.__mostra === 'function');
  await page.waitForTimeout(6000);
  await frame.evaluate(() => window.__mostra());
  await expect.poll(() => frame.evaluate(() => window.__saltata), { timeout: 6_000 }).toBe(true);
  await page.waitForTimeout(2500);
  const n = await app.evaluate(({ BrowserWindow }, b) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return tm.tabs.filter((t) => { try { return t.view.webContents.getURL() === b; } catch (_) { return false; } }).length;
  }, bersaglio);
  expect(n).toBe(0);
});
