// #737 giro 3, rilievo 1: il clic vero dato al lettore incorporato attiva anche la pagina che lo ospita (gesto regalato al sito).
import { test as base, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const test = base.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-adskip-v3-');
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
<script>window.__saltata=false;document.getElementById('salta').addEventListener('click',(e)=>{if(!e.isTrusted)return;
document.getElementById('slot').style.display='none';window.__saltata=true;window.__saltataAlle=Date.now();});
setTimeout(()=>{window.__mostrataAlle=Date.now();document.getElementById('slot').style.display='block';},9000);</script></body></html>`;

// Il sito ospite non tocca niente: guarda soltanto se il gesto dell'utente gli arriva, e allora prova ad aprire una finestra.
const OSPITE = (src) => `<!doctype html><title>Blog</title><body style="margin:8px"><p>articolo</p>
  <iframe id="yt" src="${src}" width="720" height="420"></iframe>
  <script>window.__accensioni=[];let prima=false;setInterval(()=>{const ora=navigator.userActivation.isActive;
    if(ora&&!prima){let f=false;try{f=!!window.open('about:blank','_blank','popup');}catch(_){}window.__accensioni.push({alle:Date.now(),finestra:f});}
    prima=ora;},5);</script></body>`;

test('il clic vero al lettore incorporato non attiva la pagina del sito che lo ospita', async ({ openTab, testServer }) => {
  const dentro = testServer.html(LETTORE).replace('127.0.0.1', 'www.youtube.com');
  const page = await openTab(testServer.html(OSPITE(dentro)));
  await expect.poll(() => page.frames().find((f) => f.url() === dentro) || null, { timeout: 5_000 }).not.toBeNull();
  const frame = page.frames().find((f) => f.url() === dentro);
  // Ogni evaluate di Playwright è un gesto e attiva la pagina: niente evaluate finché il «Salta» non è premuto, che parte da solo.
  await page.waitForTimeout(15_000);
  const { mostrata, saltata } = await frame.evaluate(() => ({ mostrata: window.__mostrataAlle, saltata: window.__saltataAlle }));
  expect(saltata, 'il «Salta» premuto col clic vero').toBeGreaterThan(0);
  const accensioni = await page.evaluate(([da, a]) => window.__accensioni.filter((x) => x.alle >= da && x.alle <= a), [mostrata, saltata + 1000]);
  expect(accensioni, 'il sito ospite non si accende col clic dato al lettore').toEqual([]);
});
