// #737.1 giro 8: un clic vero dato a un documento che la pagina si scrive da sola (riquadro vuoto riempito dallo
// script, pagina riscritta con document.open) deve aprire la scheda che chiede, col blocco acceso.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;

for (const modo of ['collegamento', 'pulsante']) {
  test(`r1 il ${modo} dentro un riquadro che la pagina riempie da sé apre la sua scheda al clic`, async ({ app, openTab, testServer }) => {
    const dest = testServer.html('<title>DAL RIQUADRO</title>');
    const page = await openTab(testServer.html(`<iframe id="f" width="400" height="200"></iframe><script>
      var DEST=${JSON.stringify(dest)};var d=document.getElementById('f').contentDocument;
      if (${JSON.stringify(modo)}==='collegamento') { var a=d.createElement('a');a.id='b';a.href=DEST;a.target='_blank';a.textContent='apri';a.style.cssText='display:block;width:200px;height:60px';d.body.appendChild(a); }
      else { var b=d.createElement('button');b.id='b';b.textContent='apri';b.style.cssText='width:200px;height:60px';b.onclick=function(){window.open(DEST)};d.body.appendChild(b); }
      </script>`));
    // Lontano dall'attivazione che danno le chiamate di Playwright.
    await page.waitForTimeout(5600);
    await page.frames().find((f) => f !== page.mainFrame()).click('#b');
    await expect.poll(() => aperteSu(app, dest), { timeout: 6000 }).toBe(1);
  });
}

test('r1 il collegamento di una pagina che si riscrive con document.open apre la sua scheda al clic', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>RISCRITTA</title>');
  const page = await openTab(testServer.html(`<p>caricamento</p><script>var DEST=${JSON.stringify(dest)};
    setTimeout(function(){document.open();document.write('<a id=b target=_blank style="display:block;width:200px;height:60px" href="'+DEST+'">apri</a>');document.close();},300);
    </script>`));
  await page.waitForTimeout(5600);
  await page.click('#b');
  await expect.poll(() => aperteSu(app, dest), { timeout: 6000 }).toBe(1);
});
