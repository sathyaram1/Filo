// #737.1 giro 10: il clic dell'utente dentro un riquadro vuoto che la pagina riempie da sé, messo in un componente con
// radice ombra, apre la scheda che chiede (prima di questo lavoro si apriva).
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;

for (const modo of ['open', 'closed']) {
  test(`r1 clic su un collegamento a scheda nuova nel riquadro vuoto di un componente (radice ${modo})`, async ({ app, openTab, testServer }) => {
    const dest = testServer.html('<title>DEST</title>');
    const page = await testServer.openReady(openTab, `<div id="h"></div><script>
      var r=document.getElementById('h').attachShadow({mode:'${modo}'});var f=document.createElement('iframe');f.width=400;f.height=200;r.appendChild(f);
      var d=f.contentDocument;var a=d.createElement('a');a.id='b';a.href=${JSON.stringify(dest)};a.target='_blank';a.textContent='apri';
      a.style.cssText='display:block;width:200px;height:60px';d.body.appendChild(a);</script>`);
    // Lontano da ogni input dato alla scheda prima di questo clic.
    await page.waitForTimeout(5600);
    await page.frames().find((f) => f !== page.mainFrame()).click('#b');
    await expect.poll(() => aperteSu(app, dest), { timeout: 6000 }).toBe(1);
  });
}
