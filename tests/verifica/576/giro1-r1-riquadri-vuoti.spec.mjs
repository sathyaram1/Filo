// Verifica #576, rilievo 1: un'immagine o un riquadro caricati da un server della pubblicità bloccato non lasciano un buco in pagina.
import { test, expect } from '../../fixtures/electron.mjs';

test('immagine e riquadro di un server pubblicitario bloccato spariscono dalla pagina', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => {
    const A = globalThis.__filoAdblock;
    A.setDomainsForTest(['blocked.test']);
    A.setCosmeticForTest('##.ad-slot');
    A.configureFromSettings({ security: { adblock: { enabled: true } } });
  });
  const adUrl = testServer.html('<!doctype html><body style="background:#c00">ANNUNCIO</body>').replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, `<!doctype html><title>V576_R1</title>
<h1>Pantheon S01E02</h1>
<iframe id="pub" src="${adUrl}" width="728" height="90"></iframe>
<a href="/partner"><img id="img" src="${adUrl.replace(/\/\d+$/, '/banner.gif')}" width="300" height="250"></a>
<p id="testo">testo dopo</p>`, { pubblico: true });
  const altezze = () => page.evaluate(() => ({
    riquadro: document.getElementById('pub').getBoundingClientRect().height,
    immagine: document.getElementById('img').getBoundingClientRect().height,
    testo: document.getElementById('testo').getBoundingClientRect().height > 0,
  }));
  await expect.poll(altezze, { timeout: 5_000 }).toEqual({ riquadro: 0, immagine: 0, testo: true });
});
