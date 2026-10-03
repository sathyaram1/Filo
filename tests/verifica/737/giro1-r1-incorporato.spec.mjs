// #737 giro 1, rilievo 1: un video di YouTube incorporato in un altro sito non salta la pubblicità.
import { test as base, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const test = base.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-adskip-v-');
    const app = await electron.launch({
      args: [...argomentiScala, '--host-resolver-rules=MAP www.youtube.com 127.0.0.1, MAP sito-pubblico.test 127.0.0.1', '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

function lettore({ dopoMs = 1200, nascondi = 'display' } = {}) {
  const prima = nascondi === 'display' ? 'display:none' : 'opacity:0';
  const dopo = nascondi === 'display' ? "s.style.display='block'" : "s.style.opacity='1'";
  return `<!doctype html><html><head><meta charset="utf-8"><title>YT</title><style>
  body{margin:0}#movie_player{position:relative;width:640px;height:360px;background:#222;margin:20px}
  #slot{position:absolute;right:0;bottom:60px;${prima}}#slot button{padding:10px 22px}
  </style></head><body><div id="movie_player"><div id="slot"><button class="ytp-skip-ad-button" id="salta">Salta</button></div></div>
  <script>window.__clic=[];window.__saltata=false;
  document.getElementById('salta').addEventListener('click',(e)=>{window.__clic.push(e.isTrusted);if(!e.isTrusted)return;window.__saltata=true;document.getElementById('slot').style.display='none';});
  window.__mostra=()=>{const s=document.getElementById('slot');${dopo};};
  ${dopoMs >= 0 ? `setTimeout(window.__mostra, ${dopoMs});` : ''}</script></body></html>`;
}
const suYT = (u) => u.replace('127.0.0.1', 'www.youtube.com');

test('lettore di YouTube incorporato in un altro sito: il «Salta» si preme', async ({ openTab, testServer }) => {
  const dentro = suYT(testServer.html(lettore({ dopoMs: 1200 })));
  const page = await openTab(testServer.html(`<!doctype html><title>Blog</title><p>articolo</p><iframe src="${dentro}" width="720" height="420"></iframe>`));
  await expect.poll(() => page.frames().find((f) => f.url() === dentro) || null, { timeout: 5_000 }).not.toBeNull();
  const frame = page.frames().find((f) => f.url() === dentro);
  await frame.waitForTimeout(6000);
  const s = await frame.evaluate(() => ({ saltata: window.__saltata, clic: window.__clic }));
  expect(s.saltata).toBe(true);
});
