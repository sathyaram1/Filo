// Verifica #1494: il «Salta» premuto con YouTube in sottofondo, a finestra vera (solo Linux: lo schermo è virtuale).

import { test as base, expect } from '../../fixtures/electron.mjs';
import { createServer as createHttpsServer } from 'node:https';
import { request as richiestaHttp } from 'node:http';
import { certificato } from '../../helpers/immagineFirmata.mjs';
import { apriFiloSenzaPlaywright } from '../../helpers/filoSenzaPlaywright.mjs';

const ARGOMENTI_RETE = ['--host-resolver-rules=MAP www.youtube.com 127.0.0.1, MAP www.youtube-nocookie.com 127.0.0.1, MAP sito-pubblico.test 127.0.0.1',
  '--ignore-certificate-errors', '--no-proxy-server'];

const test = base.extend({
  suYouTube: async ({ testServer }, use) => {
    const { der, privateKey } = certificato({ organizzazione: 'Filo test', nomeComune: 'www.youtube.com', usi: [] });
    const cert = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
    const b = new URL(testServer.origin);
    const srv = createHttpsServer({ key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert }, (req, res) => {
      const inoltro = richiestaHttp({ host: b.hostname, port: b.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode || 502, r.headers);
        r.pipe(res);
      });
      inoltro.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(inoltro);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    await use((url) => url.replace(testServer.origin, `https://www.youtube.com:${srv.address().port}`));
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  },
});

function lettore(titolo) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${titolo}</title><style>
  body{margin:0}#p{position:relative;width:640px;height:360px;background:#222;margin:20px}
  #slot{position:absolute;right:0;bottom:60px;display:none}#slot button{padding:10px 22px}
  </style></head><body><div id="p"><div id="slot"><button class="ytp-skip-ad-button" id="salta">Salta</button></div></div>
  <script>
    window.__clic = []; window.__saltate = 0;
    document.getElementById('salta').addEventListener('click', (e) => {
      window.__clic.push(e.isTrusted);
      if (!e.isTrusted) return;
      document.getElementById('slot').style.display = 'none';
      window.__saltate++;
    });
    window.__mostra = () => { document.getElementById('slot').style.display = 'block'; };
  </script></body></html>`;
}

test('r1 un video di YouTube incorporato in un blog, visto e poi lasciato dietro: la pubblicità si salta senza tornare sulla scheda', async ({ testServer, suYouTube }) => {
  test.skip(process.platform !== 'linux', 'finestra vera');
  test.setTimeout(120_000);
  const filo = await apriFiloSenzaPlaywright({ args: ARGOMENTI_RETE, env: { FILO_HIDE_WINDOW: '0' } });
  const nel = (u, c) => filo.nelFrame(u, c);
  const quando = (fn, message, timeout = 10_000) => expect.poll(fn, { timeout, message }).toBe(true);
  const apri = (url) => filo.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()
    .find((w) => w._filoTabs)._filoTabs.openTab(u, { activate: true }), url);
  try {
    const dentro = suYouTube(testServer.html(lettore('Video')));
    const blog = testServer.html(`<!doctype html><title>Blog</title><p>articolo</p><iframe src="${dentro}" width="720" height="420"></iframe>`, { pubblico: true });
    await apri(blog);
    await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'visible', 'il video non si vede');
    await apri(testServer.html('<title>Altra</title><p>altra</p>'));
    await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'hidden', 'il video non è dietro');
    await nel(dentro, 'window.__mostra()');
    await quando(async () => (await nel(dentro, 'window.__saltate')) === 1, 'pubblicità non saltata finché la scheda resta dietro', 10_000);
  } finally {
    await filo.chiudi();
  }
});

test('r1 la pubblicità di un video di YouTube incorporato comparsa mentre la scheda era dietro: tornando, si salta e il sito non riceve il clic', async ({ testServer, suYouTube }) => {
  test.skip(process.platform !== 'linux', 'finestra vera');
  test.setTimeout(240_000);
  const filo = await apriFiloSenzaPlaywright({ args: ARGOMENTI_RETE, env: { FILO_HIDE_WINDOW: '0' } });
  const nel = (u, c) => filo.nelFrame(u, c);
  const quando = (fn, message, timeout = 10_000) => expect.poll(fn, { timeout, message }).toBe(true);
  const apri = (url) => filo.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()
    .find((w) => w._filoTabs)._filoTabs.openTab(u, { activate: true }), url);
  const attiva = (url) => filo.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((t) => t.view.webContents.getURL() === u).id);
  }, url);
  try {
    // Il passaggio sbaglia in più della metà delle prove: quattro giri, uno basta a vederlo.
    for (let i = 0; i < 4; i++) {
      const dentro = suYouTube(testServer.html(lettore(`Video ${i}`)));
      const blog = testServer.html(`<!doctype html><title>Blog ${i}</title><p>articolo</p><iframe src="${dentro}" width="720" height="420"></iframe>`
        + '<script>window.__gesti=[];["pointerdown","mousedown","click"].forEach((t)=>document.addEventListener(t,(e)=>{if(e.isTrusted)window.__gesti.push(t);},true));</script>', { pubblico: i % 2 === 1 });
      await apri(blog);
      await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'visible', `giro ${i}: il video non si vede`);
      await apri(testServer.html(`<title>Altra ${i}</title><p>altra</p>`));
      await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'hidden', `giro ${i}: il video non è dietro`);
      await nel(dentro, 'window.__mostra()');
      await new Promise((ok) => setTimeout(ok, 2500));
      await attiva(blog);
      await quando(async () => (await nel(dentro, 'window.__saltate')) === 1, `giro ${i}: tornati sulla scheda, la pubblicità non si salta`, 10_000);
      expect(await nel(blog, 'window.__gesti'), `giro ${i}: il sito ha ricevuto il clic di Filo`).toEqual([]);
    }
  } finally {
    await filo.chiudi();
  }
});
