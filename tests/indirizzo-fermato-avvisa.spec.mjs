// #482 — Un indirizzo che Filo ferma per sicurezza (file del computer, cartelle di rete, data:, javascript:) lo dice con
// una notifica di solo testo, da ogni porta che lo ferma; e la posta va al programma di posta anche rinavigando una scheda.
// #1318 — le strade equivalenti fanno lo stesso: script della pagina, assistente, barra.

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
  // La scheda d'avvio nasce quando vuole: contata prima che ci sia, sembrava una scheda aperta dal file.
  await expect.poll(async () => (await schede(app)).length, { timeout: 10_000 }).toBeGreaterThan(0);
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
  // Lo stesso testo che dice l'assistente (#1318): il percorso diventa il file che è, come dalla barra.
  await expect(await carta(avvisi, 'File del computer bloccato per sicurezza: C:/Users/agenti AI/Desktop/nota.txt')).toBeVisible({ timeout: 8000 });
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
  expect(await nelModello(shell, 'bloccat'), 'un clic finto della pagina, o uno che la pagina si tiene, non fa nascere avvisi').toBe(0);

  await page.mouse.click(40, 30);
  // Il percorso lo sceglie la pagina, e lo può imitare: l'avviso nomina il sito (#1318 giro 1).
  await expect(await carta(avvisi, 'Percorso di rete chiesto da 127.0.0.1')).toBeVisible({ timeout: 8000 });
  await page.mouse.click(40, 30, { button: 'middle' });
  await page.waitForTimeout(400);
  expect(await nelModello(shell, 'Percorso di rete chiesto'), 'cliccato di nuovo, l\'avviso resta uno').toBe(1);
  expect(await nelModello(shell, 'bilancio.xlsx')).toBe(0);
  expect(page.url()).toContain('127.0.0.1');
});

test('«Apri in nuova tab» del menu di Filo su un collegamento a un file di una pagina web lo dice', async ({ openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <a id="f" href="file:///C:/Condivisa/listino.pdf" style="display:block;width:300px;padding:20px">listino</a></body></html>`);
  await page.locator('#f').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  await menu.getByText('Apri in nuova tab', { exact: false }).click();
  await expect(await carta(avvisi, 'File del computer chiesto da 127.0.0.1')).toBeVisible({ timeout: 8000 });
});

// Giro 2: un percorso scritto com'è (cartella di rete, Mac, Linux) non diventa una ricerca del percorso su Google.
// #1318: nemmeno la chiavetta di Linux sotto /run/media, né un percorso fra virgolette («Copia come percorso» di Windows)
// o fra apici inversi; e l'assistente sa cosa è stato fermato.
for (const [percorso, testo] of [
  ['\\\\nas\\condivisa\\bilancio.xlsx', 'Percorso di rete bloccato per sicurezza: //nas/condivisa/bilancio.xlsx'],
  ['/home/utente/Documenti/conto.pdf', 'File del computer bloccato per sicurezza: /home/utente/Documenti/conto.pdf'],
  ['~/Scaricati/foto.jpg', 'File del computer bloccato per sicurezza: ~/Scaricati/foto.jpg'],
  ['/run/media/utente/CHIAVETTA/conto.pdf', 'File del computer bloccato per sicurezza: /run/media/utente/CHIAVETTA/conto.pdf'],
  ['"C:\\Users\\agenti AI\\Documenti\\conto.pdf"', 'File del computer bloccato per sicurezza: C:/Users/agenti AI/Documenti/conto.pdf'],
  ['`/media/utente/USB/foto.jpg`', 'File del computer bloccato per sicurezza: /media/utente/USB/foto.jpg'],
]) {
  test(`un percorso scritto com'è (${percorso}) è fermato e detto, dall'assistente e da una scheda nuova`, async ({ app, shell, avvisi }) => {
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    let home = null;
    await expect.poll(() => { home = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(home); }).toBe(true);
    await home.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
    const r = await home.evaluate((u) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: u } }), percorso);
    expect(r && r.output && r.output.blocked, 'l\'assistente non sa che il file è stato fermato').toBe('scheme');
    expect(r.output.avviso, 'l\'assistente sa quale file è stato fermato').toBe(testo);

    const prima = await schede(app);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), percorso);
    await expect(await carta(avvisi, testo)).toBeVisible({ timeout: 8000 });
    expect(await schede(app)).toEqual(prima);
    expect((await schede(app)).some((u) => /google\.[a-z]+\/search/.test(decodeURIComponent(u))), 'il percorso non diventa una ricerca').toBe(false);
  });
}

// #1318 — Le pagine che aprono un file o un data: da script dopo il clic dell'utente: Chromium li rifiuta prima di Filo.
const homeDiFilo = async (app, shell) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let home = null;
  await expect.poll(() => { home = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(home); }).toBe(true);
  await home.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
  return home;
};
const naviga = (home, url) => home.evaluate((u) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: u } }), url);
const cercheGoogle = async (app) => (await schede(app)).filter((u) => /google\.[a-z]+\/search/.test(u));

test('su una pagina web un file o un data: aperto da script dopo un clic lo dice; la pagina da sola no', async ({ shell, openTab, testServer, avvisi }) => {
  const page = await openTab(testServer.html(`<title>Intranet</title>
    <button id="doc" style="position:fixed;left:0;top:0;width:300px;height:40px">Apri documento</button>
    <button id="fin" style="position:fixed;left:0;top:60px;width:300px;height:40px">Apri in una finestra</button>
    <a id="dat" href="data:text/html,<h1>ricevuta</h1>" style="position:fixed;left:0;top:120px;width:300px;height:40px;display:block">ricevuta</a>
    <script>
      document.getElementById('doc').onclick = function () { location.href = 'file:///srv/intranet/circolare.pdf'; };
      document.getElementById('fin').onclick = function () { window.open('file://nas/condivisa/listino.xlsx', '_blank', 'width=400,height=300'); };
      setTimeout(function () { location.href = 'file:///tmp/da-sola.pdf'; location.href = 'data:text/html,da-sola'; window.open('data:text/html,da-sola'); }, 300);
    </script>`));
  await page.waitForTimeout(1200);
  expect(await nelModello(shell, 'bloccat'), 'la pagina da sola non fa nascere avvisi').toBe(0);

  await page.mouse.click(40, 20);
  const c = await carta(avvisi, 'File del computer chiesto da 127.0.0.1');
  await expect(c).toBeVisible({ timeout: 8000 });
  await expect(c.locator('.shell-notif-action'), 'un blocco di sicurezza non si scavalca').toHaveCount(0);
  await page.mouse.click(40, 80);
  await expect(await carta(avvisi, 'Percorso di rete chiesto da 127.0.0.1')).toBeVisible({ timeout: 8000 });
  await page.mouse.click(40, 140);
  await expect(await carta(avvisi, 'Indirizzo «data:» chiesto da 127.0.0.1')).toBeVisible({ timeout: 8000 });
  expect(page.url()).toContain('127.0.0.1');
  expect(await nelModello(shell, 'circolare.pdf'), 'il percorso scelto dalla pagina non entra nell\'avviso').toBe(0);
});

test('un clic che fa rifiutare più file dice un avviso solo', async ({ shell, openTab, testServer, avvisi }) => {
  const page = await openTab(testServer.html(`<title>Raffica</title>
    <button id="r" style="position:fixed;left:0;top:0;width:300px;height:40px">Apri tutto</button>
    <script>
      document.getElementById('r').onclick = function () {
        window.open('file:///tmp/primo.pdf'); window.open('file:///tmp/secondo.pdf');
        var i = new Image(); i.src = 'file:///tmp/terzo.png'; document.body.appendChild(i);
      };
    </script>`));
  await page.waitForTimeout(500);
  await page.mouse.click(40, 20);
  await expect(await carta(avvisi, 'File del computer chiesto da 127.0.0.1')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(600);
  expect(await nelModello(shell, 'bloccat')).toBe(1);
});

test('localhost con la porta scritto senza http si apre dall\'assistente, da Filo e da un collegamento di Filo, come dalla barra', async ({ app, shell, testServer, avvisi }) => {
  const indirizzo = (titolo) => testServer.html(`<title>${titolo}</title><p>server di sviluppo</p>`).replace('http://127.0.0.1', 'localhost');
  const aperta = (u) => expect.poll(async () => (await schede(app)).includes(`http://${u}`), { timeout: 10000 }).toBe(true);
  const home = await homeDiFilo(app, shell);

  const dallAssistente = indirizzo('Assistente');
  const r = await naviga(home, dallAssistente);
  expect(r && r.output && r.output.blocked, 'non è un indirizzo da fermare').toBeFalsy();
  expect(r.executed).toBe(true);
  await aperta(dallAssistente);

  const daFilo = indirizzo('Filo');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), daFilo);
  await aperta(daFilo);

  const daCollegamento = indirizzo('Collegamento');
  await home.evaluate((u) => { window.open(u, '_blank'); }, daCollegamento);
  await aperta(daCollegamento);

  expect(await nelModello(shell, 'bloccat'), 'nessun «bloccato per sicurezza» per una pagina che si apre').toBe(0);
  expect(await cercheGoogle(app)).toEqual([]);
});

test('la posta chiesta all\'assistente va al programma di posta, come cliccata in una pagina', async ({ app, shell }) => {
  await intercettaEsterni(app);
  const home = await homeDiFilo(app, shell);
  const prima = await schede(app);
  const r = await naviga(home, 'mailto:mario.rossi@esempio.it?subject=Cena');
  expect(r && r.output && r.output.blocked, 'la posta non è un indirizzo da fermare').toBeFalsy();
  expect(r.executed).toBe(true);
  expect(r.output.esterno).toBe('mailto:');
  await expect.poll(() => esterni(app), { timeout: 6000 }).toEqual(['mailto:mario.rossi@esempio.it?subject=Cena']);
  await shell.waitForTimeout(400);
  expect(await schede(app), 'nessuna scheda in più').toEqual(prima);
  expect(await nelModello(shell, 'bloccat')).toBe(0);
});

// #1318 giro 1 — l'avviso nasce da un'apertura, non da un'immagine della pagina; e il testo della pagina non ci entra.
test('un\'immagine incollata da Word che compare dopo un clic non fa dire a Filo che ha fermato un file', async ({ shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<title>Notizie</title>
    <button style="position:fixed;left:0;top:0;width:300px;height:40px" onclick="document.getElementById('n').innerHTML='<p>Circolare</p><img src=&quot;file:///C:/Users/mario/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png&quot;>'">Leggi la notizia</button>
    <button style="position:fixed;left:0;top:50px;width:300px;height:40px" onclick="location.href='file:///C:/Intranet/circolare.pdf'">Apri documento</button>
    <div id="n" style="margin-top:100px"></div>`));
  await page.waitForTimeout(800);
  await page.mouse.click(40, 20);
  await expect(page.locator('#n p')).toHaveText('Circolare');
  await page.waitForTimeout(1500);
  expect(await nelModello(shell, 'bloccat'), 'l\'immagine non è un\'apertura dell\'utente').toBe(0);
  // Il clic dopo, su un'apertura vera, lo dice ancora.
  await page.mouse.click(40, 70);
  await expect.poll(() => nelModello(shell, 'File del computer chiesto da 127.0.0.1'), { timeout: 8000 }).toBe(1);
});

test('una pagina che scrive da sé la riga di Chromium non mette il suo testo in un avviso di Filo', async ({ shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<title>Truffa</title>
    <button style="position:fixed;left:0;top:0;width:300px;height:40px" onclick="console.error('Not allowed to load local resource: file:///home/Chiama il 02 1234 5678 per sbloccare')">Continua</button>`));
  await page.waitForTimeout(800);
  await page.mouse.click(40, 20);
  await page.waitForTimeout(1500);
  expect(await nelModello(shell, 'Chiama il 02')).toBe(0);
});

// #1318 giro 1 — quello che l'assistente chiede di aprire non diventa mai una ricerca data per pagina aperta.
for (const [scritto, avviso] of [
  ['/data/progetti/conto.pdf', 'File del computer bloccato per sicurezza: /data/progetti/conto.pdf'],
  ['Documenti\\conto.pdf', 'File del computer bloccato per sicurezza: Documenti/conto.pdf'],
  ['%USERPROFILE%\\Desktop\\conto.pdf', 'File del computer bloccato per sicurezza: %USERPROFILE%/Desktop/conto.pdf'],
  ['"C:\\Users\\agenti AI\\Documenti\\conto.pdf".', 'File del computer bloccato per sicurezza: C:/Users/agenti AI/Documenti/conto.pdf'],
  // #1318 giro 5 — un percorso relativo o un nome di file non è un sito inventato dato per aperto.
  ['../Documenti/conto.pdf', 'File del computer bloccato per sicurezza: ../Documenti/conto.pdf'],
  ['conto.pdf', 'File del computer bloccato per sicurezza: conto.pdf'],
  ['ricetta carbonara', '«ricetta carbonara» non è un indirizzo'],
]) {
  test(`l'assistente non trasforma «${scritto}» in una ricerca: lo ferma e sa perché`, async ({ app, shell }) => {
    const home = await homeDiFilo(app, shell);
    const prima = await schede(app);
    const r = await naviga(home, scritto);
    expect(r && r.executed, 'non è una pagina aperta').toBeFalsy();
    expect(r.output && r.output.avviso).toBe(avviso);
    await shell.waitForTimeout(500);
    expect(await schede(app)).toEqual(prima);
    expect(await cercheGoogle(app)).toEqual([]);
  });
}

test('un indirizzo di posta senza «mailto:» chiesto all\'assistente va al programma di posta, non su Google', async ({ app, shell }) => {
  await intercettaEsterni(app);
  const home = await homeDiFilo(app, shell);
  const r = await naviga(home, 'mario.rossi@esempio.it');
  expect(r && r.executed).toBe(true);
  expect(r.output && r.output.esterno).toBe('mailto:');
  await expect.poll(() => esterni(app), { timeout: 6000 }).toEqual(['mailto:mario.rossi@esempio.it']);
  expect(await cercheGoogle(app)).toEqual([]);
});
