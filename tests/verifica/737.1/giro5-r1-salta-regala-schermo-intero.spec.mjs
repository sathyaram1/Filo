// #737.1 giro 5: il «Salta» che Filo preme da solo nel lettore incorporato non è un gesto dell'utente, nemmeno per lo schermo intero.
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
      args: [...argomentiScala, '--host-resolver-rules=MAP www.youtube.com 127.0.0.1, MAP sito-pubblico.test 127.0.0.1', '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

const lettore = (dopoMs) => `<!doctype html><html><head><meta charset="utf-8"><title>Lettore</title><style>
  body{margin:0}#movie_player{position:relative;width:640px;height:360px;background:#222;margin:20px}
  #slot{position:absolute;right:0;bottom:60px;display:none}#slot button{padding:10px 22px;font:16px sans-serif}</style></head><body>
  <div id="movie_player" class="html5-video-player ad-showing"><video muted></video>
  <div id="slot"><button class="ytp-skip-ad-button" id="salta">Salta</button></div></div>
  <script>window.__clic=[];document.getElementById('salta').addEventListener('click',(e)=>{window.__clic.push(e.isTrusted);
  document.getElementById('movie_player').classList.remove('ad-showing');document.getElementById('slot').style.display='none';});
  setTimeout(()=>{document.getElementById('slot').style.display='block'},${dopoMs});</script></body></html>`;

test('il «Salta» premuto da Filo nel lettore incorporato non porta a schermo intero il sito che lo ospita', async ({ app, openTab, testServer }) => {
  test.setTimeout(60000);
  const dentro = testServer.html(lettore(9000)).replace('127.0.0.1', 'www.youtube.com');
  const ospite = `<!doctype html><title>N</title><body><p>articolo</p><iframe id="yt" src="${dentro}" width="720" height="420"></iframe>
  <script>setTimeout(function(){window.__pronto=1},7500);
  setInterval(function(){ if (window.__visto) return; var a=navigator.userActivation.isActive;
    if (a && window.__pronto) { window.__visto=1; document.documentElement.requestFullscreen().then(function(){document.title='FS-SI'},function(){document.title='FS-NO'}); return; }
    document.title=(a?'A':'N')+(window.__pronto?'P':''); },30);</script></body>`;
  const url = testServer.html(ospite, { pubblico: true });
  await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.openTab(u), url);
  const titolo = () => app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const x = t.tabs.find((y) => { try { return y.view.webContents.getURL().includes('sito-pubblico'); } catch (_) { return false; } });
    return x ? x.view.webContents.getTitle() : '';
  });
  await expect.poll(titolo, { timeout: 15000 }).toBe('NP');
  await new Promise((r) => setTimeout(r, 4000));
  const fin = await titolo();
  const clic = await app.evaluate(({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => { try { return w.getURL().includes('sito-pubblico'); } catch (_) { return false; } });
    const f = wc.mainFrame.framesInSubtree.find((x) => x.url.includes('youtube'));
    return f ? f.executeJavaScript('JSON.stringify(window.__clic)') : 'nofr';
  });
  expect(clic, 'Filo ha premuto il «Salta» con un clic vero').toBe('[true]');
  expect(fin, 'il sito ospite non va a schermo intero senza un gesto').not.toBe('FS-SI');
});
