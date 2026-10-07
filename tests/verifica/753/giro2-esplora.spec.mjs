// Esplorazione del giro 2 di #753: altre strade verso i riquadri e cambio di modalità.
import { test, expect } from '../../fixtures/electron.mjs';

test('riquadri: frames[], srcdoc, data:, sandbox', async ({ openTab, testServer }) => {
  const figlio = testServer.html(`<!doctype html><html><head><script>
    parent.postMessage({ k: 'sandbox', v: String(navigator.globalPrivacyControl) }, '*');
  </script></head><body>s</body></html>`);
  const url = testServer.html(`<!doctype html><html><head><script>
    window.__r = { pagina: String(navigator.globalPrivacyControl) };
    addEventListener('message', (e) => { if (e.data && e.data.k) __r[e.data.k] = e.data.v; });
  </script></head><body>
  <iframe name="vuoto"></iframe>
  <iframe srcdoc="<script>parent.postMessage({k:'srcdoc',v:String(navigator.globalPrivacyControl)},'*')</script>"></iframe>
  <iframe src="data:text/html,<script>parent.postMessage({k:'data',v:String(navigator.globalPrivacyControl)},'*')</script>"></iframe>
  <iframe sandbox="allow-scripts" src="${figlio}"></iframe>
  <script>
    __r.framesIndice = String(frames[0].navigator.globalPrivacyControl);
    __r.framesNome = String(window.vuoto.navigator.globalPrivacyControl);
    document.body.insertAdjacentHTML('beforeend', '<iframe></iframe>');
    __r.innerHTMLframes = String(window[window.length - 1].navigator.globalPrivacyControl);
  </script></body></html>`);
  const page = await openTab(url);
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => window.__r);
  console.log('ESPLORA', JSON.stringify(r));
});

test('modalità: manuale e poi di nuovo automatico con incognito aperto', async ({ app, openTab, shell, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html(`<!doctype html><html><head><script>
    window.__g = String(navigator.globalPrivacyControl);
  </script></head><body>x</body></html>`);
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
  for (const valore of ['manual', 'default']) {
    const sec = await openTab('filo://security/');
    await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 8_000 });
    await sec.locator(`input[name="cookie-mode"][value="${valore}"]`).check();
    await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  }
  await app.evaluate(({ BrowserWindow }, u) => {
    BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(u);
  }, url + '?inc');
  let pag = null;
  await expect.poll(() => { pag = app.windows().find((w) => { try { return w.url().endsWith('?inc'); } catch (_) { return false; } }); return !!pag; }, { timeout: 15_000 }).toBe(true);
  await pag.waitForFunction(() => window.__g !== undefined);
  console.log('ESPLORA incognito dopo manuale->automatico', await pag.evaluate(() => window.__g));
});
