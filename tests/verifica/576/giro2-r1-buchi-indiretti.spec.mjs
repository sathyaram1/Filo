import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

// Annunci fermati dal blocco ma arrivati per una strada indiretta: rinvio da un server non in lista,
// riquadro mandato altrove da uno script, immagine dentro un riquadro. Il buco deve chiudersi lo stesso.
test('giro 2 r1: gli annunci fermati per strade indirette non lasciano il buco', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => {
    const A = globalThis.__filoAdblock;
    A.setDomainsForTest(['blocked.test']);
    A.configureFromSettings({ security: { adblock: { enabled: true } } });
  });
  const srv = createServer((req, res) => {
    res.writeHead(302, { Location: `http://blocked.test:${srv.address().port}/creativo.gif` });
    res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const ad = testServer.origin.replace('127.0.0.1', 'blocked.test');
    const dentro = testServer.html(`<!doctype html><body style="margin:0"><img src="${ad}/dentro.gif" width="300" height="250"></body>`);
    const scritto = JSON.stringify(`<body style="margin:0"><img src="${ad}/w.gif" width="300" height="250"></body>`);
    const page = await testServer.openReady(openTab, `<!doctype html><title>PUB_INDIRETTA</title>
<a href="/partner"><img id="rinvio" src="http://127.0.0.1:${srv.address().port}/click?x=1" width="300" height="250"></a>
<iframe id="mandato" width="300" height="250"></iframe>
<iframe id="scritto" width="300" height="250"></iframe>
<iframe id="altrui" src="${dentro}" width="300" height="250"></iframe>
<p id="testo">testo</p>
<script>{ const d = document.getElementById('scritto').contentDocument; d.open(); d.write(${scritto}); d.close(); }
setTimeout(() => { document.getElementById('mandato').contentWindow.location.href = '${ad}/nav.html'; }, 100);</script>`, { pubblico: true });
    const altezze = () => page.evaluate(() => Object.fromEntries(
      ['rinvio', 'mandato', 'scritto', 'altrui', 'testo'].map((id) => [id, Math.round(document.getElementById(id).getBoundingClientRect().height) > 0]),
    ));
    await expect.poll(altezze, { timeout: 6_000 }).toEqual({ rinvio: false, mandato: false, scritto: false, altrui: false, testo: true });
  } finally {
    srv.close();
  }
});
