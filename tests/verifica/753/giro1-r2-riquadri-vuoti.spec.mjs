// Verifica #753 giro 1, rilievo 2: navigator.globalPrivacyControl deve valere true anche nei riquadri vuoti
// creati dalla pagina (about:blank) e nei worker, come nel documento e negli iframe caricati.

import { test, expect } from '../../fixtures/electron.mjs';

test('riquadri about:blank creati dalla pagina e worker leggono GPC come la pagina', async ({ openTab, testServer }) => {
  const url = testServer.html(`<!doctype html><html><head><script>
    window.__r = { pagina: String(navigator.globalPrivacyControl) };
    var f = document.createElement('iframe'); document.head.appendChild(f);
    __r.vuotoDaScript = String(f.contentWindow.navigator.globalPrivacyControl);
  </script></head><body>
  <iframe id="ab" src="about:blank"></iframe>
  <script>
    setTimeout(function () { __r.vuotoNellHtml = String(document.getElementById('ab').contentWindow.navigator.globalPrivacyControl); }, 300);
    var w = new Worker(URL.createObjectURL(new Blob(['postMessage(String(navigator.globalPrivacyControl))'])));
    w.onmessage = function (e) { __r.worker = e.data; };
  </script></body></html>`);
  const page = await openTab(url);
  await page.waitForFunction(() => window.__r && window.__r.vuotoNellHtml && window.__r.worker, null, { timeout: 10_000 });
  expect(await page.evaluate(() => window.__r)).toEqual({ pagina: 'true', vuotoDaScript: 'true', vuotoNellHtml: 'true', worker: 'true' });
});
