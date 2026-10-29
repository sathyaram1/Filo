// Sonda del giro 5 di #1318: porte non coperte dalle prove del ramo.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});
const nelModello = (shell, testo) => shell.evaluate((t) => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1' && c.textContent.includes(t)).length, testo);
const testi = (shell) => shell.evaluate(() => [...document.querySelectorAll('#shell-notifs > .shell-notif')].map((c) => c.textContent));
const homeDiFilo = async (app, shell) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let home = null;
  await expect.poll(() => { home = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(home); }).toBe(true);
  await home.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
  return home;
};
const naviga = (home, url) => home.evaluate((u) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: u } }), url);

for (const scritto of ['index.html', 'pagina.htm', 'app.js', 'conto.pdf.']) {
  test(`sonda: l'assistente con «${scritto}»`, async ({ app, shell }) => {
    const home = await homeDiFilo(app, shell);
    const prima = await schede(app);
    const r = await naviga(home, scritto);
    await shell.waitForTimeout(800);
    const dopo = await schede(app);
    console.log('SONDA', scritto, JSON.stringify(r), JSON.stringify(dopo.filter((u) => !prima.includes(u))));
    expect(r && r.executed, 'un nome di file non è una pagina aperta').toBeFalsy();
  });
}

test('sonda: data: aperto da script dopo un clic', async ({ shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<title>Ricevute</title>
    <button id="a" style="position:fixed;left:0;top:0;width:300px;height:40px">Ricevuta</button>
    <button id="b" style="position:fixed;left:0;top:60px;width:300px;height:40px">Ricevuta in finestra</button>
    <script>
      document.getElementById('a').onclick = function () { location.href = 'data:text/html,<h1>ricevuta</h1>'; };
      document.getElementById('b').onclick = function () { window.open('data:text/html,<h1>ricevuta2</h1>'); };
    </script>`));
  await page.waitForTimeout(600);
  await page.mouse.click(40, 20);
  await page.waitForTimeout(2500);
  const a = await nelModello(shell, 'data:');
  await page.mouse.click(40, 80);
  await page.waitForTimeout(2500);
  const b = await nelModello(shell, 'data:');
  console.log('SONDA data', a, b, JSON.stringify(await testi(shell)));
  expect(a, 'pulsante che porta a un data:').toBeGreaterThan(0);
});

test('sonda: riquadro in un componente con shadow DOM caricato dopo un clic', async ({ shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<title>Intranet</title>
    <button id="a" style="position:fixed;left:0;top:0;width:300px;height:40px">Anteprima</button>
    <div id="host" style="margin-top:100px"></div>
    <script>
      var root = document.getElementById('host').attachShadow({ mode: 'open' });
      document.getElementById('a').onclick = function () {
        var f = document.createElement('iframe'); f.src = 'file:///C:/Intranet/anteprima.html'; root.appendChild(f);
      };
    </script>`));
  await page.waitForTimeout(600);
  await page.mouse.click(40, 20);
  await page.waitForTimeout(2500);
  console.log('SONDA shadow', JSON.stringify(await testi(shell)));
  expect(await nelModello(shell, 'bloccat')).toBe(0);
});

test('sonda: riquadro tolto subito dopo un clic', async ({ shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<title>Intranet</title>
    <button id="a" style="position:fixed;left:0;top:0;width:300px;height:40px">Controlla</button>
    <script>
      document.getElementById('a').onclick = function () {
        var f = document.createElement('iframe'); f.style.display = 'none'; f.src = 'file:///C:/Intranet/sonda.html';
        document.body.appendChild(f); setTimeout(function () { f.remove(); }, 0);
      };
    </script>`));
  await page.waitForTimeout(600);
  await page.mouse.click(40, 20);
  await page.waitForTimeout(2500);
  console.log('SONDA tolto', JSON.stringify(await testi(shell)));
  expect(await nelModello(shell, 'bloccat')).toBe(0);
});
