// Esplorazione della verifica di #1318: da cancellare.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});
const testi = (shell) => shell.evaluate(() => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1').map((c) => c.textContent.trim()));
const homeDiFilo = async (app, shell) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let home = null;
  await expect.poll(() => { home = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(home); }).toBe(true);
  await home.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
  return home;
};
const naviga = (home, url) => home.evaluate((u) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: u } }), url);

test('pagina: varianti da script', async ({ shell, openTab, testServer }) => {
  const bottoni = [
    ['assign', "location.assign('file:///C:/Intranet/a-assign.pdf')"],
    ['replace', "location.replace('file:///C:/Intranet/b-replace.pdf')"],
    ['form', "var f=document.createElement('form');f.action='file:///C:/Intranet/c-form.pdf';document.body.appendChild(f);f.submit()"],
    ['blank', "var a=document.createElement('a');a.href='file:///C:/Intranet/d-blank.pdf';a.target='_blank';document.body.appendChild(a);a.click()"],
    ['datapng', "location.href='data:image/png;base64,iVBORw0KGgo='"],
    ['datapdf', "location.href='data:application/pdf;base64,JVBERi0xLjQK'"],
    ['dataopen', "window.open('data:text/html,<b>e-open</b>')"],
    ['spoof', "console.error('Not allowed to load local resource: file:///Chiama il 02 1234 5678 per sbloccare')"],
    ['lazy', "var i=document.createElement('img');i.src='file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/clip_image001.png';document.body.appendChild(i)"],
    ['top', "top.location.href='file:///C:/Intranet/f-top.pdf'"],
  ];
  const html = `<title>Varianti</title>${bottoni.map(([id, js], n) => `<button id="${id}" style="position:fixed;left:0;top:${n * 45}px;width:300px;height:40px" onclick="${js.replace(/"/g, '&quot;')}">${id}</button>`).join('')}`;
  const page = await openTab(testServer.html(html));
  await page.waitForTimeout(800);
  const esiti = {};
  for (let n = 0; n < bottoni.length; n++) {
    const prima = (await testi(shell)).length;
    await page.mouse.click(40, n * 45 + 20);
    await page.waitForTimeout(1500);
    const dopo = await testi(shell);
    esiti[bottoni[n][0]] = { nuovi: dopo.slice(prima), url: page.url() };
  }
  console.log(JSON.stringify(esiti, null, 2));
});

test('assistente: forme di percorso e indirizzi', async ({ app, shell }) => {
  const home = await homeDiFilo(app, shell);
  const casi = [
    '/data/progetti/conto.pdf', '/workspace/x.pdf', 'Documenti\\conto.pdf', "'C:\\Users\\x\\conto.pdf'",
    '"/home/utente/a b.pdf"', 'file:C:/x.pdf', '%USERPROFILE%\\Desktop\\x.pdf', '$HOME/x.pdf', 'C:\\Users\\x\\conto.pdf.',
    '"C:\\Users\\x\\conto.pdf".', 'D:', 'Desktop/nota.txt', 'mario.rossi@esempio.it', 'nas.lan:5000', 'LOCALHOST:3000/app',
    '[::1]:3000', 'localhost:99999', 'smb://nas/share/x', '/gnu/store/x', '\\\\?\\C:\\x.pdf', '“/run/media/u/USB/a.pdf”',
    'C:/Users/x/conto.pdf', '/Volumes/USB/a.pdf', 'tel:+390212345', '  "C:\\a b\\c.pdf"  ',
  ];
  const out = {};
  for (const c of casi) {
    const r = await naviga(home, c);
    out[c] = { executed: r && r.executed, output: r && r.output };
  }
  await shell.waitForTimeout(1500);
  console.log(JSON.stringify(out, null, 2));
  console.log(JSON.stringify(await schede(app), null, 2));
  console.log(JSON.stringify(await testi(shell), null, 2));
});
