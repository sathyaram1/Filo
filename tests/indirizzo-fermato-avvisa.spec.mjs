// #482, #1318 — Un indirizzo che Filo ferma per sicurezza (file del computer, cartelle di rete, data:, javascript:) lo dice
// con una notifica di solo testo, da ogni porta che lo ferma; la posta va al programma di posta da ogni porta, anche
// dall'assistente; un percorso non diventa mai una ricerca, e «localhost:3000» si apre come dalla barra.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { home as laChat, modelloFinto, chiamateAlModello, chiedi, ripristina } from './helpers/chatFinta.mjs';

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
// L'assistente della home: chiede le azioni come le chiede il modello.
async function laHome(app, shell) {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let home = null;
  await expect.poll(() => { home = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(home); }).toBe(true);
  await home.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
  return home;
}
const naviga = (home, url) => home.evaluate((u) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: u } }), url);
const ricerche = async (app) => (await schede(app)).filter((u) => /google\.[a-z]+\/search/.test(decodeURIComponent(u)));

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
// #1318: nemmeno sotto /run/media (la chiavetta su Linux), fra le virgolette di «Copia come percorso» o fra apici inversi.
for (const [percorso, testo] of [
  ['\\\\nas\\condivisa\\bilancio.xlsx', 'Percorso di rete bloccato per sicurezza: //nas/condivisa/bilancio.xlsx'],
  ['/home/utente/Documenti/conto.pdf', 'File del computer bloccato per sicurezza: /home/utente/Documenti/conto.pdf'],
  ['~/Scaricati/foto.jpg', 'File del computer bloccato per sicurezza: ~/Scaricati/foto.jpg'],
  ['/run/media/mario/CHIAVETTA/tesi.docx', 'File del computer bloccato per sicurezza: /run/media/mario/CHIAVETTA/tesi.docx'],
  ['"C:\\Users\\agenti AI\\Desktop\\nota.txt"', 'File del computer bloccato per sicurezza: C:\\Users\\agenti AI\\Desktop\\nota.txt'],
  ['`/home/mario/Documenti/conto 2026.pdf`', 'File del computer bloccato per sicurezza: /home/mario/Documenti/conto 2026.pdf'],
]) {
  test(`un percorso scritto com'è (${percorso}) è fermato e detto, dall'assistente e da una scheda nuova`, async ({ app, shell, avvisi }) => {
    const home = await laHome(app, shell);
    const r = await naviga(home, percorso);
    expect(r && r.output && r.output.blocked, 'l\'assistente non sa che il file è stato fermato').toBe('scheme');
    expect(r.executed, 'l\'assistente lo riporterebbe come pagina aperta').toBe(false);
    expect(r.output.avviso, 'l\'assistente non sa cosa è stato fermato').toBe(testo);

    const prima = await schede(app);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), percorso);
    await expect(await carta(avvisi, testo)).toBeVisible({ timeout: 8000 });
    expect(await schede(app)).toEqual(prima);
    expect((await schede(app)).some((u) => /google\.[a-z]+\/search/.test(decodeURIComponent(u))), 'il percorso non diventa una ricerca').toBe(false);
  });
}

// #1318 — un file o un data: che la pagina apre da sé dopo il clic dell'utente, ma non da un collegamento, lo rifiuta
// Chromium prima di Filo: lo dice come il clic su un collegamento. Un'immagine o uno sfondo con un file: dentro no.
test('su una pagina web il pulsante che porta a un file, la finestra a parte su un file e il collegamento data: lo dicono', async ({ shell, openTab, testServer, avvisi }) => {
  const page = await openTab(testServer.html(`<title>Intranet</title>
    <button style="position:fixed;left:0;top:0;width:300px;height:50px" onclick="location.href='file:///C:/Intranet/Documenti/circolare.pdf'">Apri documento</button>
    <button style="position:fixed;left:0;top:60px;width:300px;height:50px" onclick="window.open('file:///srv/condivisa/listino.pdf', 'doc', 'width=600,height=400')">Apri in una finestra</button>
    <a href="data:text/html,<h1>anteprima</h1>" style="position:fixed;left:0;top:120px;width:300px;height:50px;display:block">Anteprima</a>
    <button style="position:fixed;left:0;top:180px;width:300px;height:50px" onclick="var i=new Image();i.src='file:///C:/Users/mario/AppData/Local/Temp/clip_image001.png';document.body.appendChild(i);var d=document.createElement('div');d.style.cssText='width:9px;height:9px;background:url(file:///tmp/sfondo.png)';document.body.appendChild(d)">Apri la mail</button>
    <a href="data:text/plain,ciao" download="saluto.txt" style="position:fixed;left:0;top:240px;width:300px;height:50px;display:block">Scarica</a>
    <button style="position:fixed;left:0;top:300px;width:300px;height:50px" onclick="for (var i = 0; i < 6; i++) window.open('file:///tmp/raffica-' + i + '.pdf')">Raffica</button>
    <script>setTimeout(function () { location.href = 'file:///tmp/da-sola.pdf'; }, 300)</script>`));
  await page.waitForTimeout(1000);
  expect(await nelModello(shell, 'da-sola'), 'la pagina da sola resta muta').toBe(0);

  await page.mouse.click(40, 205);
  await page.mouse.click(40, 265);
  await page.waitForTimeout(1200);
  expect(await nelModello(shell, 'clip_image001'), 'un\'immagine con un file dentro non l\'ha aperta nessuno').toBe(0);
  expect(await nelModello(shell, 'sfondo.png'), 'uno sfondo con un file dentro non l\'ha aperto nessuno').toBe(0);
  expect(await nelModello(shell, 'data:'), 'un data: col «download» si scarica, non è fermato').toBe(0);

  await page.mouse.click(40, 25);
  const c = await carta(avvisi, 'File del computer bloccato per sicurezza: C:/Intranet/Documenti/circolare.pdf');
  await expect(c).toBeVisible({ timeout: 8000 });
  await expect(c.locator('.shell-notif-action')).toHaveCount(0);
  await page.mouse.click(40, 85);
  await expect(await carta(avvisi, 'File del computer bloccato per sicurezza: /srv/condivisa/listino.pdf')).toBeVisible({ timeout: 8000 });
  await page.mouse.click(40, 145);
  await expect(await carta(avvisi, 'Indirizzo «data:» bloccato per sicurezza')).toBeVisible({ timeout: 8000 });

  await page.mouse.click(40, 325);
  await expect(await carta(avvisi, 'raffica-')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(800);
  expect(await nelModello(shell, 'raffica-'), 'un clic, un avviso: la pagina non ne fa nascere una raffica').toBe(1);
  expect(page.url()).toContain('127.0.0.1');
});

// #1318 — chiesto all'assistente o aperto da Filo, un server della rete di casa scritto senza http si apre come dalla barra.
test.describe('un indirizzo locale con la porta, senza http', () => {
  test.use({ hostInPiu: ['nas.lan'] });

  test('localhost:porta e nas.lan:porta si aprono dall\'assistente e da una scheda nuova, senza avvisi', async ({ app, shell, testServer }) => {
    const porta = new URL(testServer.origin).port;
    const pagina = (titolo) => testServer.html(`<title>${titolo}</title><h1>${titolo}</h1>`).split('/').pop();
    const contenuto = async (url) => {
      let w = null;
      await expect.poll(() => { w = app.windows().find((x) => x.url() === url); return Boolean(w); }, { message: `nessuna scheda su ${url}`, timeout: 10000 }).toBe(true);
      await w.waitForLoadState('domcontentloaded');
      return w.textContent('h1');
    };
    const home = await laHome(app, shell);

    const sviluppo = pagina('Server di sviluppo');
    const r = await naviga(home, `localhost:${porta}/${sviluppo}`);
    expect(r && r.output && r.output.blocked, 'localhost con la porta non è uno schema sconosciuto').toBeFalsy();
    expect(r.executed).toBe(true);
    expect(await contenuto(`http://localhost:${porta}/${sviluppo}`)).toBe('Server di sviluppo');

    const nas = pagina('Il NAS di casa');
    const r2 = await naviga(home, `nas.lan:${porta}/${nas}`);
    expect(r2 && r2.output && r2.output.blocked).toBeFalsy();
    expect(r2.executed).toBe(true);
    expect(await contenuto(`http://nas.lan:${porta}/${nas}`)).toBe('Il NAS di casa');

    const daFilo = pagina('Aperto da Filo');
    const aperta = await shell.evaluate((u) => window.filoShell.tabs.open(u), `localhost:${porta}/${daFilo}`);
    expect(aperta && aperta.id, 'da Filo localhost con la porta è fermato').toBeTruthy();
    expect(await contenuto(`http://localhost:${porta}/${daFilo}`)).toBe('Aperto da Filo');

    expect(await nelModello(shell, 'bloccat'), 'nessun «bloccato per sicurezza» per un server di casa').toBe(0);
    expect(await ricerche(app)).toEqual([]);
  });
});

// #1318 — «scrivi una mail a Mario»: dall'assistente come da un clic su una pagina o da una scheda, al programma di posta.
test('l\'indirizzo di posta (e il telefono) chiesto all\'assistente va al programma del computer, non è fermato', async ({ app, shell }) => {
  await intercettaEsterni(app);
  const home = await laHome(app, shell);
  const posta = 'mailto:mario.rossi@example.com?subject=Cena%20di%20sabato&body=Ciao%20Mario';
  const r = await naviga(home, posta);
  expect(r && r.output && r.output.blocked, 'la posta non è un indirizzo da fermare').toBeFalsy();
  expect(r.executed).toBe(true);
  expect(r.output.esterno).toBe('mailto');
  await expect.poll(() => esterni(app), { timeout: 6000 }).toEqual([posta]);

  const r2 = await naviga(home, 'tel:+390612345678');
  expect(r2.executed).toBe(true);
  await expect.poll(() => esterni(app), { timeout: 6000 }).toEqual([posta, 'tel:+390612345678']);

  await shell.waitForTimeout(400);
  expect(await nelModello(shell, 'bloccat')).toBe(0);
  expect(await ricerche(app)).toEqual([]);
});

// #1318 — nella chat la risposta parte da quello che è successo davvero: il modello riceve cosa è stato fermato e perché,
// la riga del lavoro lo dice, e la mail è andata al programma di posta.
test('nella chat il percorso della chiavetta è detto fermato e la mail va al programma di posta', async ({ app, shell }) => {
  await intercettaEsterni(app);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8000 });
  const page = await laChat(app);
  const posta = 'mailto:mario@example.com?subject=Ciao';
  await modelloFinto(app, [
    { toolCalls: [
      { id: 'p1', name: 'NAVIGA', arguments: JSON.stringify({ url: '/run/media/mario/CHIAVETTA/tesi.docx', etichetta: 'tesi' }) },
      { id: 'm1', name: 'NAVIGA', arguments: JSON.stringify({ url: posta, etichetta: 'Mail a Mario' }) },
    ] },
    { text: 'La tesi non la apro, la mail è pronta.' },
  ]);
  await chiedi(page, 'apri la tesi sulla chiavetta e scrivi una mail a Mario');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'la mail è pronta' })).toBeVisible({ timeout: 10000 });

  const giri = await chiamateAlModello(app);
  const risultati = JSON.stringify(giri[giri.length - 1]);
  expect(risultati).toContain('Pagina NON aperta (File del computer bloccato per sicurezza: /run/media/mario/CHIAVETTA/tesi.docx)');
  expect(risultati).toContain('Aperto il programma di posta del computer');
  await expect.poll(() => esterni(app), { timeout: 6000 }).toEqual([posta]);
  expect(await ricerche(app), 'il percorso non diventa una ricerca').toEqual([]);

  const lavoro = page.locator('.dash-activity');
  await lavoro.locator('.dash-activity-head').click();
  const riga = lavoro.locator('.dash-activity-row', { hasText: 'Link non aperto · file del computer bloccato per sicurezza' });
  await expect(riga).toHaveCount(1);
  const nodo = lavoro.getByRole('button', { name: /2 azioni/ });
  await expect(nodo, 'la mail non è una pagina aperta').toHaveText('2 azioni · pagina, posta');
  await nodo.click();
  await expect(riga).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/1318-chat-percorso-fermato.png' });
  await ripristina(app);
});
