// #753 giro 2, rilievo 1: un riquadro vuoto raggiunto da frames[], dal nome o dall'indice della finestra
// deve leggere GPC come la pagina che lo contiene.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 riquadri vuoti raggiunti per indice o per nome leggono GPC come la pagina', async ({ openTab, testServer }) => {
  const url = testServer.html(`<!doctype html><html><head><script>
    window.__r = { pagina: String(navigator.globalPrivacyControl) };
  </script></head><body>
  <iframe name="vuoto"></iframe>
  <script>
    __r.framesIndice = String(frames[0].navigator.globalPrivacyControl);
    __r.framesNome = String(window.vuoto.navigator.globalPrivacyControl);
    document.body.insertAdjacentHTML('beforeend', '<iframe></iframe>');
    __r.scrittoDopo = String(window[window.length - 1].navigator.globalPrivacyControl);
    __r.fatto = true;
  </script></body></html>`);
  const page = await openTab(url);
  await page.waitForFunction(() => window.__r && window.__r.fatto, null, { timeout: 10_000 });
  expect(await page.evaluate(() => window.__r)).toEqual({
    pagina: 'true', framesIndice: 'true', framesNome: 'true', scrittoDopo: 'true', fatto: true,
  });
});
