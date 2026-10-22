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

test('r2 YouTube lasciato dietro mentre si leggevano i commenti più giù: la pubblicità si salta lo stesso', async ({ testServer, suYouTube }) => {
  test.skip(process.platform !== 'linux', 'finestra vera');
  test.setTimeout(120_000);
  const filo = await apriFiloSenzaPlaywright({ args: ARGOMENTI_RETE, env: { FILO_HIDE_WINDOW: '0' } });
  const nel = (u, c) => filo.nelFrame(u, c);
  const quando = (fn, message, timeout = 10_000) => expect.poll(fn, { timeout, message }).toBe(true);
  const apri = (url) => filo.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()
    .find((w) => w._filoTabs)._filoTabs.openTab(u, { activate: true }), url);
  try {
    const yt = suYouTube(testServer.html(lettore('Canzone').replace('</body>', '<div style="height:3000px">commenti</div></body>')));
    await apri(yt);
    await quando(async () => (await nel(yt, 'document.visibilityState')) === 'visible', 'yt non visibile');
    await nel(yt, 'scrollTo(0, 1500); scrollY');
    await apri(testServer.html('<title>Altra</title><p>altra</p>'));
    await quando(async () => (await nel(yt, 'document.visibilityState')) === 'hidden', 'yt non nascosta');
    await nel(yt, 'window.__mostra()');
    await quando(async () => (await nel(yt, 'window.__saltate')) === 1, 'pubblicità non saltata', 10_000);
  } finally {
    await filo.chiudi();
  }
});
