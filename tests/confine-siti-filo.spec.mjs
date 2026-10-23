// #1506 — Il confine fra i siti e le pagine di Filo. Una pagina web non porta la sua scheda (né una scheda nuova, né la
// finestrella di accesso) su un filo:// scelto da lei: da sola, con un rinvio del server, con window.open dopo un clic,
// con un collegamento cliccato. Non incornicia una pagina di Filo, e una pagina di Filo finita in una vista del web non
// parla ai servizi come Filo. Regole: src/main/services/navigazioneVersoFilo.js e src/main/services/handlers/origine.js.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

const OPZIONI = 'filo://options/options.html';
const HOME = 'filo://newtab/';
const ERRORE = 'filo://error/error.html?url=https%3A%2F%2Fbanca.example%2F&code=-105&desc=Chiama+il+numero+verde';

let rinvii;
test.beforeAll(async () => {
  rinvii = createServer((req, res) => {
    const verso = { '/errore': ERRORE, '/opzioni': OPZIONI, '/home': HOME }[req.url.split('?')[0]];
    if (!verso) { res.writeHead(404); res.end(); return; }
    res.writeHead(302, { Location: verso });
    res.end();
  });
  await new Promise((r) => rinvii.listen(0, '127.0.0.1', r));
});
test.afterAll(async () => { await new Promise((r) => rinvii.close(r)); });
const rinvio = (verso) => `http://127.0.0.1:${rinvii.address().port}/${verso}`;

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => {
    let vista = '';
    try { vista = t.view.webContents.getURL(); } catch (_) {}
    return { id: t.id, url: t.url, vista, interna: t.isInternal, titolo: t.title };
  });
});
const suFilo = async (app) => (await schede(app)).filter((t) => /^filo:\/\/(options|error)\//.test(t.vista) || /banca\.example/.test(t.url));
const carta = async (avvisi, testo) => (await avvisi()).locator('.shell-notif.show', { hasText: testo });

async function restaSulSito(app, sito) {
  const t = (await schede(app)).find((x) => x.vista === sito);
  expect(t, `la scheda resta su ${sito}`).toBeTruthy();
  expect(t.url).toBe(sito);
  expect(t.interna).toBe(false);
  expect(await suFilo(app), 'nessuna scheda arriva su una pagina di Filo scelta dal sito').toEqual([]);
}

test('una pagina che si porta da sola su una pagina di Filo resta sul sito', async ({ app, openTab, testServer }) => {
  const sito = testServer.html(`<title>Articolo</title><h1>Articolo</h1>
<script>setTimeout(function(){ location.href = ${JSON.stringify(OPZIONI)}; }, 200)</script>`);
  await openTab(sito);
  await new Promise((r) => setTimeout(r, 2500));
  await restaSulSito(app, sito);
});

test('un rinvio del server verso la pagina d’errore coi parametri del sito non la mostra, e la barra non dice un altro sito', async ({ app, openTab, testServer }) => {
  const sito = testServer.html(`<title>Articolo</title><h1>Articolo</h1>
<script>setTimeout(function(){ location.href = ${JSON.stringify(rinvio('errore'))}; }, 200)</script>`);
  await openTab(sito);
  await new Promise((r) => setTimeout(r, 2500));
  await restaSulSito(app, sito);
  expect((await schede(app)).find((x) => x.vista === sito).titolo).toBe('Articolo');
});

test('una scheda nata su un rinvio verso una pagina di Filo non resta bianca', async ({ app, shell }) => {
  const aperta = await shell.evaluate((u) => window.filoShell.tabs.open(u), rinvio('opzioni'));
  expect(aperta && aperta.id).toBeTruthy();
  await expect.poll(async () => (await schede(app)).some((t) => t.id === aperta.id), { message: 'la scheda vuota se ne va', timeout: 8000 })
    .toBe(false);
  expect(await suFilo(app)).toEqual([]);
});

test('dopo un clic né window.open né un collegamento portano su una pagina di Filo, e Filo lo dice', async ({ app, openTab, testServer, avvisi }) => {
  const sito = testServer.html(`<title>Negozio</title>
<button id="b" style="width:220px;height:60px" onclick="window.open(${JSON.stringify(OPZIONI).replace(/"/g, '&quot;')})">Apri</button>
<p><a id="nuova" href="${ERRORE}" target="_blank">nuova scheda</a></p>
<p><a id="qui" href="${OPZIONI}">stessa scheda</a></p>`);
  const page = await openTab(sito);

  // Dopo una navigazione fermata Playwright aspetterebbe un arrivo che non c'è.
  await page.click('#b', { noWaitAfter: true });
  await expect(await carta(avvisi, 'Un sito non può aprire le pagine di Filo')).toBeVisible({ timeout: 8000 });
  await (await avvisi()).screenshot({ path: 'tests/.shots/1506-pagina-di-filo-fermata.png' });
  await page.click('#nuova', { noWaitAfter: true });
  await page.click('#qui', { noWaitAfter: true });
  await new Promise((r) => setTimeout(r, 2000));
  await restaSulSito(app, sito);
});

test('un sito non incornicia una pagina di Filo', async ({ app, openTab, testServer }) => {
  const sito = testServer.html(`<title>Cornice</title><iframe id="f" src="${OPZIONI}" style="width:600px;height:400px"></iframe>`);
  await openTab(sito);
  await new Promise((r) => setTimeout(r, 2500));
  const origini = await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => x.view.webContents.getURL() === u);
    return t.view.webContents.mainFrame.framesInSubtree.filter((f) => f !== t.view.webContents.mainFrame).map((f) => f.origin);
  }, sito);
  expect(origini.length, 'il riquadro c’è').toBe(1);
  expect(origini[0], 'ma la pagina di Filo non ci si carica').not.toBe('filo://options');
});

test('dai canali dei content script un sito apre una pagina di Filo solo dopo il clic dell’utente', async ({ app, openTab, testServer }) => {
  const sito = testServer.html('<title>Pagina</title><button id="b" style="width:200px;height:60px">tocca</button>', { pubblico: true });
  const page = await openTab(sito);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  const manda = (msg) => app.evaluate(async ({ BrowserWindow }, [u, m]) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => x.view.webContents.getURL() === u);
    return t.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `chrome.runtime.sendMessage(${JSON.stringify(m)})` }]);
  }, [sito, msg]);
  const MSG = await app.evaluate(() => globalThis.SN_MSG.MSG);

  const senzaClic = [
    await manda({ type: MSG.OPEN_URL, url: ERRORE }),
    await manda({ type: MSG.OPEN_NEW_TAB, url: OPZIONI }),
    await manda({ type: '_tabs:create', url: OPZIONI }),
  ];
  for (const r of senzaClic) expect(r && r.code).toBe('forbidden');
  await new Promise((r) => setTimeout(r, 1000));
  expect(await suFilo(app)).toEqual([]);

  // Il clic dell'utente sulla pagina, come quello su una voce del menu di Filo: la pagina di Filo si apre.
  await page.click('#b');
  const r = await manda({ type: MSG.OPEN_URL, url: OPZIONI });
  expect(r && r.ok).toBe(true);
  await expect.poll(async () => (await schede(app)).filter((t) => t.vista.startsWith('filo://options/')).map((t) => t.interna), { timeout: 8000 })
    .toEqual([true]);
});

// Le pagine https della finestrella le serve Filo stesso, come in tests/finestrella-di-accesso.spec.mjs.
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
const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=1&redirect_uri=x';
const finestrella = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((w) => !w._filoTabs && !w.isDestroyed() && w.webContents._filoFinestrella)
  .map((w) => w.webContents.getURL()));

test('la finestrella di accesso non arriva su una pagina di Filo, e una pagina di Filo lì dentro non parla come Filo', async ({ app, openTab, testServer }) => {
  await servi(app, {
    'accounts.google.com/o/oauth2/v2/auth': `<title>Accedi</title><h1>Accesso</h1><script>
setTimeout(function(){ location.href = ${JSON.stringify(OPZIONI)}; }, 200);
setTimeout(function(){ window.open(${JSON.stringify(ERRORE)}); }, 400);</script>`,
  });
  const page = await testServer.openReady(openTab, `<title>Negozio</title><button id="b" style="width:220px;height:60px"
  onclick="window.open(${JSON.stringify(GOOGLE).replace(/"/g, '&quot;')},'login','width=420,height=520')">Accedi con…</button>`);
  await page.click('#b');
  await expect.poll(() => finestrella(app), { timeout: 8000 }).toEqual([GOOGLE]);
  await new Promise((r) => setTimeout(r, 2000));
  expect(await finestrella(app), 'la finestrella resta sull’accesso').toEqual([GOOGLE]);
  expect(await suFilo(app), 'e non apre schede di Filo').toEqual([]);

  // Se una pagina di Filo ci finisse lo stesso, i suoi content script non valgono come Filo.
  const MSG = await app.evaluate(() => globalThis.SN_MSG.MSG);
  const risposte = await app.evaluate(async ({ BrowserWindow }, [u, tipo]) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && !x.isDestroyed() && x.webContents._filoFinestrella);
    await w.webContents.loadURL(u).catch(() => {});
    for (let i = 0; i < 80; i++) {
      const pronta = await w.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: 'typeof chrome === "object" && !!chrome.runtime' }]).catch(() => false);
      if (pronta) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const dallaFinestrella = await w.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `chrome.runtime.sendMessage({ type: ${JSON.stringify(tipo)} })` }]);
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    const id = tm.openTab(u);
    const t = tm.tabs.find((x) => x.id === id);
    await new Promise((r) => { if (!t.view.webContents.isLoading()) r(); else t.view.webContents.once('did-stop-loading', r); });
    const dallaScheda = await t.view.webContents.executeJavaScript(`chrome.runtime.sendMessage({ type: ${JSON.stringify(tipo)} })`);
    return { dallaFinestrella, dallaScheda };
  }, [OPZIONI, MSG.FILE_NOME_STATO]);
  expect(risposte.dallaFinestrella && risposte.dallaFinestrella.code, JSON.stringify(risposte.dallaFinestrella)).toBe('forbidden');
  expect(risposte.dallaScheda && risposte.dallaScheda.ok, 'la stessa pagina in una scheda di Filo risponde').toBe(true);
});

// La home nuda è l'unica pagina di Filo che un sito può chiedere: arriva come home vera, anche da un rinvio del server.
test('un rinvio del server verso la home la apre come home vera di Filo', async ({ app, openTab, testServer }) => {
  const sito = testServer.html(`<title>Va a casa</title><script>setTimeout(function(){ location.href = ${JSON.stringify(rinvio('home'))}; }, 200)</script>`);
  await openTab(sito);
  const ultima = () => app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs[tm.tabs.length - 1];
    let servizi = '';
    try { servizi = await t.view.webContents.executeJavaScript('typeof (window.chrome && chrome.runtime && chrome.runtime.sendMessage)'); } catch (_) {}
    return { vista: t.view.webContents.getURL(), interna: t.isInternal, servizi };
  });
  await expect.poll(async () => (await ultima()).vista, { timeout: 8000 }).toBe(HOME);
  await expect.poll(ultima, { message: 'la home è una scheda di Filo, coi suoi servizi', timeout: 8000 })
    .toEqual({ vista: HOME, interna: true, servizi: 'function' });
});

test('la finestrella di accesso non arriva nemmeno sulla home di Filo', async ({ app, openTab, testServer }) => {
  await servi(app, {
    'accounts.google.com/o/oauth2/v2/auth': `<title>Accedi</title><h1>Accesso</h1><script>setTimeout(function(){ location.href = ${JSON.stringify(HOME)}; }, 200);</script>`,
  });
  const page = await testServer.openReady(openTab, `<title>Negozio</title><button id="b" style="width:220px;height:60px"
  onclick="window.open(${JSON.stringify(GOOGLE).replace(/"/g, '&quot;')},'login','width=420,height=520')">Accedi con…</button>`);
  await page.click('#b');
  await expect.poll(() => finestrella(app), { timeout: 8000 }).toEqual([GOOGLE]);
  await new Promise((r) => setTimeout(r, 2000));
  expect(await finestrella(app), 'la finestrella resta sull’accesso').toEqual([GOOGLE]);
});
