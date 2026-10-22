// Verifica #1494 giro 2: il «Salta» premuto con YouTube in sottofondo, a finestra vera (solo Linux: lo schermo è virtuale).

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

const GESTI = '<script>window.__gesti=[];["pointerdown","mousedown","click"].forEach((t)=>document.addEventListener(t,(e)=>{if(e.isTrusted)window.__gesti.push(t);},true));</script>';

async function conFilo(corpo) {
  const filo = await apriFiloSenzaPlaywright({ args: ARGOMENTI_RETE, env: { FILO_HIDE_WINDOW: '0' } });
  const nel = (u, c) => filo.nelFrame(u, c);
  const quando = (fn, message, timeout = 10_000) => expect.poll(fn, { timeout, message }).toBe(true);
  const apri = (url) => filo.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()
    .find((w) => w._filoTabs)._filoTabs.openTab(u, { activate: true }), url);
  try { await corpo({ filo, nel, quando, apri }); } finally { await filo.chiudi(); }
}

test('blog letto più giù del video incorporato, poi lasciato dietro: la pubblicità si salta', async ({ testServer, suYouTube }) => {
  test.skip(process.platform !== 'linux', 'finestra vera');
  test.setTimeout(120_000);
  await conFilo(async ({ nel, quando, apri }) => {
    const dentro = suYouTube(testServer.html(lettore('Video')));
    const blog = testServer.html(`<!doctype html><title>Blog</title><p>articolo</p><iframe src="${dentro}" width="720" height="420"></iframe>`
      + `<div style="height:4000px">resto dell'articolo</div>${GESTI}`, { pubblico: true });
    await apri(blog);
    await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'visible', 'il video non si vede');
    await nel(blog, 'scrollTo(0, 2000); scrollY');
    await apri(testServer.html('<title>Altra</title><p>altra</p>'));
    await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'hidden', 'il video non è dietro');
    await nel(dentro, 'window.__mostra()');
    await quando(async () => (await nel(dentro, 'window.__saltate')) === 1, 'pubblicità non saltata', 10_000);
    expect(await nel(blog, 'window.__gesti')).toEqual([]);
    expect(await nel(blog, 'scrollY')).toBe(2000);
  });
});

test('blog letto a metà del video incorporato (il «Salta» sopra il bordo), poi lasciato dietro: la pubblicità si salta', async ({ testServer, suYouTube }) => {
  test.skip(process.platform !== 'linux', 'finestra vera');
  test.setTimeout(120_000);
  await conFilo(async ({ nel, quando, apri }) => {
    const dentro = suYouTube(testServer.html(lettore('Video')));
    const blog = testServer.html(`<!doctype html><title>Blog</title><div style="height:600px">intro</div><iframe src="${dentro}" width="720" height="420"></iframe>`
      + `<div style="height:4000px">resto</div>${GESTI}`, { pubblico: false });
    await apri(blog);
    await quando(async () => (await nel(dentro, 'typeof window.__mostra')) === 'function', 'il video non c\'è');
    await nel(blog, 'scrollTo(0, 600 + 380); scrollY');
    await apri(testServer.html('<title>Altra</title><p>altra</p>'));
    await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'hidden', 'il video non è dietro');
    await nel(dentro, 'window.__mostra()');
    await quando(async () => (await nel(dentro, 'window.__saltate')) === 1, 'pubblicità non saltata', 10_000);
    expect(await nel(blog, 'window.__gesti')).toEqual([]);
  });
});

test('il sito copre il video incorporato con un suo elemento mentre la scheda è dietro: quell\'elemento non riceve il clic vero', async ({ testServer, suYouTube }) => {
  test.skip(process.platform !== 'linux', 'finestra vera');
  test.setTimeout(120_000);
  await conFilo(async ({ nel, quando, apri }) => {
    const dentro = suYouTube(testServer.html(lettore('Video')));
    const blog = testServer.html(`<!doctype html><title>Blog</title><style>body{margin:0}</style><iframe src="${dentro}" width="720" height="420" style="border:0;display:block"></iframe>`
      + '<div id="velo" style="position:absolute;left:0;top:0;width:720px;height:420px;display:none;background:rgba(0,0,0,0.01)"></div>'
      + `${GESTI}<script>document.addEventListener('visibilitychange',()=>{document.getElementById('velo').style.display=document.hidden?'block':'none';});</script>`, { pubblico: true });
    await apri(blog);
    await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'visible', 'il video non si vede');
    await apri(testServer.html('<title>Altra</title><p>altra</p>'));
    await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'hidden', 'il video non è dietro');
    await quando(async () => (await nel(blog, 'document.getElementById("velo").style.display')) === 'block', 'velo');
    await nel(dentro, 'window.__mostra()');
    await new Promise((ok) => setTimeout(ok, 6000));
    expect(await nel(blog, 'window.__gesti'), 'il sito ha ricevuto il clic di Filo').toEqual([]);
    expect(await nel(dentro, 'window.__saltate')).toBe(1);
  });
});

test('due pubblicità di fila nel video incorporato dietro: si saltano tutte e due', async ({ testServer, suYouTube }) => {
  test.skip(process.platform !== 'linux', 'finestra vera');
  test.setTimeout(120_000);
  await conFilo(async ({ nel, quando, apri }) => {
    const dentro = suYouTube(testServer.html(lettore('Video')));
    const blog = testServer.html(`<!doctype html><title>Blog</title><p>articolo</p><iframe src="${dentro}" width="720" height="420"></iframe>${GESTI}`, { pubblico: true });
    await apri(blog);
    await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'visible', 'il video non si vede');
    await apri(testServer.html('<title>Altra</title><p>altra</p>'));
    await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'hidden', 'il video non è dietro');
    await nel(dentro, 'window.__mostra()');
    await quando(async () => (await nel(dentro, 'window.__saltate')) === 1, 'prima non saltata', 10_000);
    await new Promise((ok) => setTimeout(ok, 1500));
    await nel(dentro, 'window.__mostra()');
    await quando(async () => (await nel(dentro, 'window.__saltate')) === 2, 'seconda non saltata', 15_000);
    expect(await nel(blog, 'window.__gesti')).toEqual([]);
  });
});

test('Filo ridotto a icona col video incorporato davanti: la pubblicità si salta', async ({ testServer, suYouTube }) => {
  test.skip(process.platform !== 'linux', 'finestra vera');
  test.setTimeout(120_000);
  await conFilo(async ({ filo, nel, quando, apri }) => {
    const dentro = suYouTube(testServer.html(lettore('Video')));
    const blog = testServer.html(`<!doctype html><title>Blog</title><p>articolo</p><iframe src="${dentro}" width="720" height="420"></iframe>${GESTI}`, { pubblico: true });
    await apri(blog);
    await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'visible', 'il video non si vede');
    await filo.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((w) => w._filoTabs).minimize(); });
    await new Promise((ok) => setTimeout(ok, 1500));
    const stato = await filo.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); return { min: w.isMinimized(), vis: w.isVisible() }; });
    console.log('finestra', JSON.stringify(stato), await nel(dentro, 'document.visibilityState'));
    await nel(dentro, 'window.__mostra()');
    await quando(async () => (await nel(dentro, 'window.__saltate')) === 1, 'pubblicità non saltata', 10_000);
    expect(await nel(blog, 'window.__gesti')).toEqual([]);
  });
});

test('blog ingrandito col video incorporato, lasciato dietro: la pubblicità si salta', async ({ testServer, suYouTube }) => {
  test.skip(process.platform !== 'linux', 'finestra vera');
  test.setTimeout(120_000);
  await conFilo(async ({ filo, nel, quando, apri }) => {
    const dentro = suYouTube(testServer.html(lettore('Video')));
    const blog = testServer.html(`<!doctype html><title>Blog</title><p>articolo</p><iframe src="${dentro}" width="720" height="420"></iframe>${GESTI}`, { pubblico: true });
    await apri(blog);
    await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'visible', 'il video non si vede');
    await filo.evaluate(({ BrowserWindow }, u) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      tm.tabs.find((t) => t.view.webContents.getURL() === u).view.webContents.setZoomFactor(1.5);
    }, blog);
    await quando(async () => (await nel(blog, 'devicePixelRatio')) > 1.4, 'zoom');
    await apri(testServer.html('<title>Altra</title><p>altra</p>'));
    await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'hidden', 'il video non è dietro');
    await nel(dentro, 'window.__mostra()');
    await quando(async () => (await nel(dentro, 'window.__saltate')) === 1, 'pubblicità non saltata', 10_000);
    expect(await nel(blog, 'window.__gesti')).toEqual([]);
  });
});

test('YouTube ingrandito lasciato dietro mentre si leggevano i commenti: la pubblicità si salta e la pagina resta dov\'era', async ({ testServer, suYouTube }) => {
  test.skip(process.platform !== 'linux', 'finestra vera');
  test.setTimeout(120_000);
  await conFilo(async ({ filo, nel, quando, apri }) => {
    const yt = suYouTube(testServer.html(lettore('Canzone').replace('</body>', '<div style="height:3000px">commenti</div></body>')));
    await apri(yt);
    await quando(async () => (await nel(yt, 'document.visibilityState')) === 'visible', 'yt non visibile');
    await filo.evaluate(({ BrowserWindow }, u) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      tm.tabs.find((t) => t.view.webContents.getURL() === u).view.webContents.setZoomFactor(1.5);
    }, yt);
    await quando(async () => (await nel(yt, 'devicePixelRatio')) > 1.4, 'zoom');
    await nel(yt, 'scrollTo(0, 1500); scrollY');
    await apri(testServer.html('<title>Altra</title><p>altra</p>'));
    await quando(async () => (await nel(yt, 'document.visibilityState')) === 'hidden', 'yt non nascosta');
    await nel(yt, 'window.__mostra()');
    await quando(async () => (await nel(yt, 'window.__saltate')) === 1, 'pubblicità non saltata', 10_000);
    await expect.poll(() => nel(yt, 'scrollY'), { timeout: 5_000 }).toBe(1500);
  });
});
