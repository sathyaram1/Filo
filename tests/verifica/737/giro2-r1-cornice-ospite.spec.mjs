// #737 giro 2, rilievo 1: il sito che ospita il lettore di YouTube si prende il clic vero con un suo riquadro messo sopra.
import { test as base, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const test = base.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-adskip-v2-');
    const app = await electron.launch({
      args: [...argomentiScala, '--host-resolver-rules=MAP www.youtube.com 127.0.0.1', '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

const LETTORE = `<!doctype html><html><head><meta charset="utf-8"><title>YT</title><style>
body{margin:0}#movie_player{position:relative;width:640px;height:360px;background:#222;margin:20px}
#slot{position:absolute;right:0;bottom:60px;display:none}#slot button{padding:10px 22px}
</style></head><body><div id="movie_player"><div id="slot"><button class="ytp-skip-ad-button" id="salta">Salta</button></div></div>
<script>window.__mostra=()=>{document.getElementById('slot').style.display='block';};setTimeout(window.__mostra,1000);</script></body></html>`;

// Il sito ospite copre il lettore con un SUO riquadro trasparente e gli rigira il gettone che il lettore gli manda:
// il riquadro del sito lo ripete al padre, e il clic vero cade su di lui.
const TRAPPOLA = `<!doctype html><body style="margin:0;background:transparent"><script>
  window.__gesti=[];['pointerdown','mousedown','click'].forEach((t)=>document.addEventListener(t,(e)=>{if(e.isTrusted)window.__gesti.push(t);},true));
  addEventListener('message',(e)=>{if(e.source===parent&&e.data&&e.data.rilancia)parent.postMessage(e.data.rilancia,'*');});
  </script></body>`;
function ospite(src, trappola) {
  return `<!doctype html><title>Blog</title><body style="margin:8px"><p>articolo</p>
  <div style="position:relative;width:724px;height:424px">
    <iframe id="yt" src="${src}" width="720" height="420"></iframe>
    <iframe id="trappola" src="${trappola}" style="position:absolute;left:0;top:0;width:724px;height:424px;border:0"></iframe>
  </div>
  <script>window.__rilanciati=0;addEventListener('message',(e)=>{const d=e.data;if(d&&typeof d==='object'&&e.source!==document.getElementById('trappola').contentWindow){window.__rilanciati++;document.getElementById('trappola').contentWindow.postMessage({rilancia:d},'*');}});</script>
  </body>`;
}

test('il riquadro del sito ospite messo sopra al lettore non riceve il clic vero', async ({ openTab, testServer }) => {
  const dentro = testServer.html(LETTORE).replace('127.0.0.1', 'www.youtube.com');
  const urlTrappola = testServer.html(TRAPPOLA);
  const page = await openTab(testServer.html(ospite(dentro, urlTrappola)));
  await expect.poll(() => page.frames().find((f) => f.url() === dentro) || null, { timeout: 5_000 }).not.toBeNull();
  const trappola = page.frames().find((f) => f.url() === urlTrappola);
  await page.waitForTimeout(6000);
  // Ogni messaggio del lettore, qualunque sia la sua forma, il sito lo ripete dal suo riquadro.
  expect(await page.evaluate(() => window.__rilanciati)).toBeGreaterThan(0);
  expect(await trappola.evaluate(() => window.__gesti)).toEqual([]);
});
