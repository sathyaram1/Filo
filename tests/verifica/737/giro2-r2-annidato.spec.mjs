// #737 giro 2, rilievo 2: il lettore di YouTube incorporato tramite un riquadro intermedio (come fanno i siti che passano
// da un servizio di incorporamento) non salta la pubblicità.
import { test as base, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const test = base.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-adskip-v2b-');
    const app = await electron.launch({
      args: [...argomentiScala, '--host-resolver-rules=MAP www.youtube.com 127.0.0.1, MAP cdn.incorpora.test 127.0.0.1', '.'],
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
<script>window.__saltata=false;document.getElementById('salta').addEventListener('click',(e)=>{if(!e.isTrusted)return;window.__saltata=true;document.getElementById('slot').style.display='none';});
setTimeout(()=>{document.getElementById('slot').style.display='block';},1000);</script></body></html>`;

test('lettore di YouTube dentro un riquadro intermedio: il «Salta» si preme', async ({ openTab, testServer }) => {
  const dentro = testServer.html(LETTORE).replace('127.0.0.1', 'www.youtube.com');
  const mezzo = testServer.html(`<!doctype html><body style="margin:0"><iframe src="${dentro}" width="700" height="400" style="border:0"></iframe></body>`)
    .replace('127.0.0.1', 'cdn.incorpora.test');
  const page = await openTab(testServer.html(`<!doctype html><title>Articolo</title><p>articolo</p><iframe src="${mezzo}" width="720" height="420"></iframe>`));
  await expect.poll(() => page.frames().find((f) => f.url() === dentro) || null, { timeout: 5_000 }).not.toBeNull();
  const frame = page.frames().find((f) => f.url() === dentro);
  await expect.poll(() => frame.evaluate(() => window.__saltata), { timeout: 8_000 }).toBe(true);
});
