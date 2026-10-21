// #482 — Un indirizzo che Filo ferma per sicurezza (file del computer, cartelle di rete, data:, javascript:) lo dice con
// una notifica di solo testo, da ogni porta che lo ferma; e la posta va al programma di posta anche rinavigando una scheda.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});
const esterni = (app) => app.evaluate(() => globalThis.__esterni || []);
const intercettaEsterni = (app) => app.evaluate(({ shell }) => {
  globalThis.__esterni = [];
  shell.openExternal = async (u) => { globalThis.__esterni.push(String(u)); };
});
// La pila della shell è il modello e non si disegna: per contare anche ciò che non è (ancora) a schermo si legge lì.
const nelModello = (shell, testo) => shell.evaluate((t) => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1' && c.textContent.includes(t)).length, testo);
const carta = async (avvisi, testo) => (await avvisi()).locator('.shell-notif.show', { hasText: testo });

test('aperto da Filo in una scheda nuova, un file del computer viene fermato e lo dice, senza «Apri comunque»', async ({ app, shell, avvisi }) => {
  const prima = await schede(app);
  const r = await shell.evaluate(() => window.filoShell.tabs.open('file:///C:/Users/agenti%20AI/Documenti/conto.pdf'));
  expect(r && r.id, 'nessuna scheda per un file del computer').toBeFalsy();
  const c = await carta(avvisi, 'File del computer bloccato per sicurezza: C:/Users/agenti AI/Documenti/conto.pdf');
  await expect(c).toBeVisible({ timeout: 8000 });
  await expect(c.locator('.shell-notif-action')).toHaveCount(0);
  expect(await schede(app)).toEqual(prima);
});

test('rinavigando una scheda, una cartella di rete viene fermata e lo dice; la scheda resta dov\'era', async ({ app, shell, avvisi, testServer, openTab }) => {
  const page = await openTab(testServer.html('<title>Partenza</title><p>x</p>'));
  const partenza = page.url();
  const id = await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return tm.tabs.find((t) => t.view.webContents.getURL() === u).id;
  }, partenza);
  await shell.evaluate(([i]) => window.filoShell.tabs.navigate(i, 'file://nas/condivisa/bilancio.xlsx'), [id]);
  await expect(await carta(avvisi, 'Percorso di rete bloccato per sicurezza: //nas/condivisa/bilancio.xlsx')).toBeVisible({ timeout: 8000 });
  expect(page.url()).toBe(partenza);
});

for (const [indirizzo, testo] of [
  ['data:text/html,<h1>finta banca</h1>', 'Indirizzo «data:» bloccato per sicurezza'],
  ['javascript:alert(1)', 'Indirizzo «javascript:» bloccato per sicurezza'],
]) {
  test(`${indirizzo.split(':')[0]}: fermato sia aprendo una scheda nuova sia rinavigandone una, e lo dice`, async ({ app, shell, avvisi }) => {
    const r = await shell.evaluate((u) => window.filoShell.tabs.open(u), indirizzo);
    expect(r && r.id).toBeFalsy();
    const c = await carta(avvisi, testo);
    await expect(c).toBeVisible({ timeout: 8000 });
    await c.locator('.shell-notif-close').click();
    await expect(c).toHaveCount(0);

    const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs[0].id);
    await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, indirizzo]);
    await expect(await carta(avvisi, testo)).toBeVisible({ timeout: 8000 });
    expect((await schede(app)).some((u) => /google\.[a-z]+\/search/.test(u)), 'non diventa una ricerca').toBe(false);
  });
}

test('la posta va al programma di posta sia aprendo una scheda nuova sia rinavigandone una, mai in una ricerca', async ({ app, shell, avvisi }) => {
  await intercettaEsterni(app);
  await shell.evaluate(() => window.filoShell.tabs.open('mailto:a@b.it'));
  await expect.poll(() => esterni(app), { timeout: 6000 }).toEqual(['mailto:a@b.it']);

  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs[0].id);
  await shell.evaluate(([i]) => window.filoShell.tabs.navigate(i, 'mailto:c@d.it?subject=Ciao'), [id]);
  await expect.poll(() => esterni(app), { timeout: 6000 }).toEqual(['mailto:a@b.it', 'mailto:c@d.it?subject=Ciao']);
  await shell.waitForTimeout(500);
  expect((await schede(app)).some((u) => /google\.[a-z]+\/search/.test(u)), 'la posta non diventa una ricerca').toBe(false);
  expect(await nelModello(shell, 'bloccat')).toBe(0);
});

test('«Apri in nuova scheda» del tasto destro su un collegamento a un file lo dice', async ({ app, shell, avvisi }) => {
  await shell.waitForFunction(() => !!window.filoShell);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.apriDaCollegamento('file:///home/utente/foto.jpg'));
  await expect(await carta(avvisi, 'File del computer bloccato per sicurezza: /home/utente/foto.jpg')).toBeVisible({ timeout: 8000 });
});

test('provato più volte, l\'avviso resta uno', async ({ app, shell, avvisi }) => {
  for (let i = 0; i < 4; i++) await shell.evaluate(() => window.filoShell.tabs.open('file:///tmp/ripetuto.txt'));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: '/tmp/ripetuto.txt' })).toBeVisible({ timeout: 8000 });
  await shell.waitForTimeout(400);
  await expect(vista.locator('.shell-notif', { hasText: '/tmp/ripetuto.txt' })).toHaveCount(1);
});

test('un percorso di Windows scritto così com\'è viene fermato e lo dice come file, non come uno schema', async ({ shell, avvisi }) => {
  await shell.evaluate(() => window.filoShell.tabs.open('C:\\Users\\agenti AI\\Desktop\\nota.txt'));
  await expect(await carta(avvisi, 'File del computer bloccato per sicurezza: C:\\Users\\agenti AI\\Desktop\\nota.txt')).toBeVisible({ timeout: 8000 });
});

// Da una pagina web file: e data: li ferma Chromium prima di Filo; le app (zoommtg:, ms-teams:…) le ferma Filo.
test('su una pagina web il clic su un collegamento a un\'app fermato lo dice; il tentativo della pagina da sola no', async ({ shell, openTab, testServer, avvisi }) => {
  const page = await openTab(testServer.html(`<title>Riunione</title>
    <a id="z" href="zoommtg://zoom.us/join?confno=1" style="position:fixed;left:0;top:0;width:300px;height:60px;display:block">entra</a>
    <script>setTimeout(function(){location.href='ms-teams://da-sola'},400)</script>`));
  await page.waitForTimeout(1500);
  expect(await nelModello(shell, 'ms-teams'), 'la pagina da sola non fa nascere avvisi').toBe(0);
  await page.mouse.click(40, 30);
  const c = await carta(avvisi, 'Indirizzo «zoommtg:» bloccato per sicurezza');
  await expect(c).toBeVisible({ timeout: 8000 });
  await expect(c.locator('.shell-notif-action')).toHaveCount(0);
  expect(await nelModello(shell, 'zoommtg')).toBe(1);
  expect(await nelModello(shell, 'ms-teams')).toBe(0);
  expect(page.url()).toContain('127.0.0.1');
});

// Chromium rifiuta a una pagina web il collegamento file: prima che Filo lo veda: lo riferisce il clic dell'utente.
test('su una pagina web il clic su un collegamento a una cartella di rete lo dice; la pagina da sola o che si tiene il clic no', async ({ shell, openTab, testServer, avvisi }) => {
  const page = await openTab(testServer.html(`<title>Intranet</title>
    <a id="n" href="file://nas/condivisa/bilancio.xlsx" style="position:fixed;left:0;top:0;width:300px;height:60px;display:block">bilancio</a>
    <a id="t" href="file:///tmp/tenuto.pdf" style="position:fixed;left:0;top:100px;width:300px;height:60px;display:block">tenuto</a>
    <script>
      document.getElementById('t').addEventListener('click', function (e) { e.preventDefault(); });
      setTimeout(function () { var a = document.createElement('a'); a.href = 'file:///tmp/da-sola.pdf'; document.body.appendChild(a); a.click(); }, 300);
    </script>`));
  await page.waitForTimeout(1200);
  await page.mouse.click(40, 130);
  await page.waitForTimeout(600);
  expect(await nelModello(shell, 'da-sola'), 'un clic finto della pagina non fa nascere avvisi').toBe(0);
  expect(await nelModello(shell, 'tenuto'), 'un clic che la pagina si tiene non è un indirizzo fermato').toBe(0);

  await page.mouse.click(40, 30);
  await expect(await carta(avvisi, 'Percorso di rete bloccato per sicurezza: //nas/condivisa/bilancio.xlsx')).toBeVisible({ timeout: 8000 });
  await page.mouse.click(40, 30, { button: 'middle' });
  await page.waitForTimeout(400);
  expect(await nelModello(shell, 'bilancio.xlsx'), 'cliccato di nuovo, l\'avviso resta uno').toBe(1);
  expect(page.url()).toContain('127.0.0.1');
});

test('«Apri in nuova tab» del menu di Filo su un collegamento a un file di una pagina web lo dice', async ({ openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <a id="f" href="file:///C:/Condivisa/listino.pdf" style="display:block;width:300px;padding:20px">listino</a></body></html>`);
  await page.locator('#f').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  await menu.getByText('Apri in nuova tab', { exact: false }).click();
  await expect(await carta(avvisi, 'File del computer bloccato per sicurezza: C:/Condivisa/listino.pdf')).toBeVisible({ timeout: 8000 });
});

// Giro 2: un percorso scritto com'è (cartella di rete, Mac, Linux) non diventa una ricerca del percorso su Google.
for (const [percorso, testo] of [
  ['\\\\nas\\condivisa\\bilancio.xlsx', 'Percorso di rete bloccato per sicurezza: //nas/condivisa/bilancio.xlsx'],
  ['/home/utente/Documenti/conto.pdf', 'File del computer bloccato per sicurezza: /home/utente/Documenti/conto.pdf'],
  ['~/Scaricati/foto.jpg', 'File del computer bloccato per sicurezza: ~/Scaricati/foto.jpg'],
]) {
  test(`un percorso scritto com'è (${percorso}) è fermato e detto, dall'assistente e da una scheda nuova`, async ({ app, shell, avvisi }) => {
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    let home = null;
    await expect.poll(() => { home = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(home); }).toBe(true);
    await home.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
    const r = await home.evaluate((u) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: u } }), percorso);
    expect(r && r.output && r.output.blocked, 'l\'assistente non sa che il file è stato fermato').toBe('scheme');

    const prima = await schede(app);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), percorso);
    await expect(await carta(avvisi, testo)).toBeVisible({ timeout: 8000 });
    expect(await schede(app)).toEqual(prima);
    expect((await schede(app)).some((u) => /google\.[a-z]+\/search/.test(decodeURIComponent(u))), 'il percorso non diventa una ricerca').toBe(false);
  });
}
