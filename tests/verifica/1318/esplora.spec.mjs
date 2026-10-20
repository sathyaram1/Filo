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
  await shell.evaluate(() => {
    window.__visti = [];
    const visti = new WeakSet(); const vedi = () => { for (const c of document.querySelectorAll('#shell-notifs > .shell-notif')) { if (visti.has(c)) continue; visti.add(c); window.__visti.push(c.textContent.trim()); } };
    new MutationObserver(vedi).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const testi = (s) => s.evaluate(() => window.__visti.slice());
  const esiti = {};
  for (let n = 0; n < bottoni.length; n++) {
    const prima = (await testi(shell)).length;
    await page.mouse.click(40, n * 45 + 20);
    await page.waitForTimeout(2500);
    const dopo = await testi(shell);
    esiti[bottoni[n][0]] = { nuovi: dopo.slice(prima), url: page.url() };
  }
  console.log(JSON.stringify(esiti, null, 2));
});

test('assistente: forme di percorso e indirizzi', async ({ app, shell }) => {
  await app.evaluate(({ shell: s }) => { globalThis.__esterni = []; s.openExternal = async (u) => { globalThis.__esterni.push(String(u)); }; });
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

for (const [nome, js] of [
  ['dataopen', "window.open('data:text/html,<b>e-open</b>')"],
  ['datapdf', "location.href='data:application/pdf;base64,JVBERi0xLjQK'"],
  ['dataopenblank', "window.open('data:text/html,ciao','_blank','width=300,height=300')"],
  ['datalinkblank', "var a=document.createElement('a');a.href='data:text/html,x';a.target='_blank';document.body.appendChild(a);a.click()"],
]) {
  test(`isolato ${nome}`, async ({ shell, openTab, testServer, app }) => {
    const page = await openTab(testServer.html(`<title>Iso</title><button style="position:fixed;left:0;top:0;width:300px;height:40px" onclick="${js.replace(/"/g, '&quot;')}">b</button>`));
    await page.waitForTimeout(800);
    await page.mouse.click(40, 20);
    await page.waitForTimeout(2500);
    console.log(nome, JSON.stringify(await shell.evaluate(() => [...document.querySelectorAll('.shell-notif')].map((c) => c.textContent.trim()))), JSON.stringify(await schede(app)), app.windows().map((w) => w.url().slice(0, 60)).join(' | '));
  });
}

test('sorgente dei messaggi', async ({ openTab, testServer, app }) => {
  const page = await openTab(testServer.html(`<title>Src</title><button id="a" style="position:fixed;left:0;top:0;width:300px;height:40px" onclick="location.href='file:///tmp/vero.pdf'">a</button><button id="b" style="position:fixed;left:0;top:50px;width:300px;height:40px" onclick="console.error('Not allowed to load local resource: file:///tmp/finto.pdf')">b</button>`));
  await app.evaluate(({ webContents }) => {
    globalThis.__msg = [];
    for (const wc of webContents.getAllWebContents()) {
      if (!/127\.0\.0\.1/.test(wc.getURL())) continue;
      wc.on('console-message', (e) => { globalThis.__msg.push({ level: e.level, message: e.message, lineNumber: e.lineNumber, sourceId: e.sourceId, frame: !!e.frame }); });
    }
  });
  await page.mouse.click(40, 20); await page.waitForTimeout(800);
  await page.mouse.click(40, 70); await page.waitForTimeout(800);
  console.log(JSON.stringify(await app.evaluate(() => globalThis.__msg), null, 1));
});
