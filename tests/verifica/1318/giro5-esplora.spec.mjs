// Verifica #1318, giro 5: esplorazione delle porte dei giri passati.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});
const nelModello = (shell, testo) => shell.evaluate((t) => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1' && c.textContent.includes(t)).map((c) => c.textContent), testo);
const homeDiFilo = async (app, shell) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let h = null;
  await expect.poll(() => { h = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(h); }).toBe(true);
  await h.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
  return h;
};
const naviga = (h, url) => h.evaluate((u) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: u } }), url);

test.afterEach(async ({ app }) => { await ripristina(app); });

for (const scritto of ['./conto.pdf', '../Documenti/conto.pdf', 'conto.pdf', 'relazione.docx']) {
  test(`esplora relativo ${scritto}`, async ({ app, shell }) => {
    const h = await homeDiFilo(app, shell);
    const prima = await schede(app);
    const r = await naviga(h, scritto);
    await shell.waitForTimeout(1500);
    const dopo = await schede(app);
    console.log('ESITO', scritto, JSON.stringify(r), JSON.stringify(dopo.filter((u) => !prima.includes(u))));
  });
}

test('esplora bottone della posta nuda', async ({ app }) => {
  await app.evaluate(({ shell: s }) => { globalThis.__esterni = []; s.openExternal = async (u) => { globalThis.__esterni.push(String(u)); }; });
  await modelloFinto(app, [{ text: 'Ti apro la mail.', toolCalls: [{ id: 'm1', name: 'NAVIGA', arguments: JSON.stringify({ url: 'mario.rossi@esempio.it' }) }] }, { text: 'fatto' }]);
  const page = await home(app);
  await chiedi(page, 'scrivi una mail a mario.rossi@esempio.it');
  await expect.poll(() => app.evaluate(() => globalThis.__esterni), { timeout: 15_000 }).toEqual(['mailto:mario.rossi@esempio.it']);
  await page.waitForTimeout(1500);
  const chip = await page.evaluate(() => [...document.querySelectorAll('.dash-action-link-chip, .dash-bubble-filo a, .dash-bubble-filo button')].map((a) => `${a.tagName}|${a.getAttribute('href')}|${a.textContent.trim()}`));
  console.log('CHIP', JSON.stringify(chip));
  console.log('GIRI', (await chiamateAlModello(app)).length);
});

test('esplora caricamenti in sottofondo dopo un clic', async ({ shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<title>Intranet</title>
    <style>.ico{width:20px;height:20px}</style>
    <button id="a" style="position:fixed;left:0;top:0;width:300px;height:40px">Menu</button>
    <button id="b" style="position:fixed;left:0;top:50px;width:300px;height:40px">Aggiorna</button>
    <button id="c" style="position:fixed;left:0;top:100px;width:300px;height:40px">Suona</button>
    <div id="m" style="margin-top:160px"></div>
    <script>
      document.getElementById('a').onclick = function () { document.getElementById('m').innerHTML = '<div class="ico" style="background-image:url(file:///C:/Intranet/icone/casa.png)"></div>'; };
      document.getElementById('b').onclick = function () { var x = new XMLHttpRequest(); x.open('GET', 'file:///C:/Intranet/dati.json'); try { x.send(); } catch (e) {} };
      document.getElementById('c').onclick = function () { var s = new Audio('file:///C:/Intranet/clic.wav'); s.play().catch(function () {}); };
    </script>`));
  await page.waitForTimeout(800);
  for (const [y, nome] of [[20, 'sfondo'], [70, 'xhr'], [120, 'audio']]) {
    await page.mouse.click(40, y);
    await page.waitForTimeout(2500);
    console.log('AVVISI', nome, JSON.stringify(await nelModello(shell, 'bloccat')));
  }
});

test('esplora bottoni dei percorsi fermati', async ({ app }) => {
  const nav = (id, url) => ({ id, name: 'NAVIGA', arguments: JSON.stringify({ url }) });
  await modelloFinto(app, [{ text: 'Provo.', toolCalls: [nav('a', 'Documenti\\conto.pdf'), nav('b', './conto.pdf'), nav('c', '/data/progetti/conto.pdf'), nav('d', 'ricetta carbonara')] }, { text: 'fatto' }]);
  const page = await home(app);
  await chiedi(page, 'apri questi');
  await page.waitForTimeout(5000);
  const chip = await page.evaluate(() => [...document.querySelectorAll('.dash-bubble-filo a, .dash-bubble-filo button, .dash-action-link-chip')].map((a) => `${a.tagName}|${a.className}|${a.getAttribute('href')}|${a.textContent.trim()}`));
  console.log('CHIP2', JSON.stringify(chip, null, 1));
});

for (const [nome, corpo] of [
  ['xhr', "var x = new XMLHttpRequest(); x.open('GET', 'file:///C:/Intranet/dati.json'); try { x.send(); } catch (e) {}"],
  ['audio', "var s = new Audio('file:///C:/Intranet/clic.wav'); s.play().catch(function () {});"],
  ['fetch', "fetch('file:///C:/Intranet/dati.json').catch(function () {});"],
  ['css', "var st = document.createElement('style'); st.textContent = 'body{background:url(file:///C:/Intranet/sfondo.png)}'; document.head.appendChild(st);"],
]) {
  test(`esplora sottofondo ${nome}`, async ({ shell, openTab, testServer }) => {
    const page = await openTab(testServer.html(`<title>Intranet</title>
      <button id="a" style="position:fixed;left:0;top:0;width:300px;height:40px">Menu</button>
      <script>document.getElementById('a').onclick = function () { ${corpo} };</script>`));
    await page.waitForTimeout(800);
    await page.mouse.click(40, 20);
    await page.waitForTimeout(2500);
    console.log('AVVISI2', nome, JSON.stringify(await nelModello(shell, 'bloccat')));
  });
}
