// #1066 giro 2 — esplorazione: «Accedi con Google» dentro un riquadro del provider, e il riquadro di un altro sito
// che prova a usare il clic dato alla pagina.
import { test, expect } from '../../fixtures/electron.mjs';

async function servi(app, pagine) {
  await app.evaluate(({ session, net }, pg) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', risposta);
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
  }, pagine);
}

const finestrelle = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((w) => !w._filoTabs && !w.isDestroyed() && /^(https?|about):/.test(w.webContents.getURL()))
  .map((w) => ({ url: w.webContents.getURL(), titolo: w.getTitle() })));

const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=1&redirect_uri=x';

test('il bottone «Accedi con Google» disegnato nel riquadro di Google apre la finestrella col titolo google.com', async ({ app, openTab, testServer }) => {
  await servi(app, {
    'accounts.google.com/gsi/button': `<button id="g" style="width:200px;height:60px"
      onclick="window.open('${GOOGLE}','g','width=500,height=600')">Accedi con Google</button>`,
    'accounts.google.com/o/oauth2/v2/auth': '<title>Accedi - Google</title><h1>Google</h1>',
  });
  const page = await testServer.openReady(openTab, '<iframe id="f" src="https://accounts.google.com/gsi/button" style="width:300px;height:120px;border:0"></iframe>');
  const fr = page.frameLocator('#f');
  await fr.locator('#g').waitFor({ timeout: 8000 });
  await fr.locator('#g').click();
  await expect.poll(() => finestrelle(app), { timeout: 8000 }).toEqual([{ url: GOOGLE, titolo: 'google.com' }]);
});

test('il riquadro pubblicitario di un altro sito non usa il clic dato alla pagina per aprire una finestrella', async ({ app, openTab, testServer }) => {
  await servi(app, {
    'pubblicita.example-ads.com/ad': `<p>pubblicità</p><script>parent.postMessage('pronto','*');
      window.addEventListener('message',function(){window.open('https://pubblicita.example-ads.com/login','x','width=420,height=520')});</script>`,
    'pubblicita.example-ads.com/login': '<title>Accedi - Google</title><h1>Accedi</h1>',
  });
  const page = await testServer.openReady(openTab, `<button id="b" style="width:220px;height:60px"
    onclick="document.getElementById('f').contentWindow.postMessage('vai','*')">Leggi</button>
    <iframe id="f" src="https://pubblicita.example-ads.com/ad" style="width:300px;height:120px"></iframe>`);
  await page.frameLocator('#f').locator('p').waitFor({ timeout: 8000 });
  await page.click('#b');
  await page.waitForTimeout(2500);
  expect(await finestrelle(app)).toEqual([]);
});
