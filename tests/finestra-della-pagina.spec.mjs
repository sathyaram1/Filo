// La finestra che una pagina apre col clic resta sua, come in un browser: la riempie, la porta altrove, la chiude, le
// risponde. Diventa una scheda di Filo con le stesse difese delle altre. Regola: setWindowOpenHandler in src/main/tabs.js.

import { test, expect } from './fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => {
    try { return { id: t.id, url: t.view.webContents.getURL(), titolo: t.view.webContents.getTitle(), attiva: t.id === tm.activeId }; } catch (_) { return { id: t.id, url: t.url || '', titolo: '', attiva: false }; }
  });
});
const nellaScheda = (app, titolo, js) => app.evaluate(({ BrowserWindow }, [ti, codice]) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => { try { return x.view.webContents.getTitle() === ti; } catch (_) { return false; } });
  return t ? t.view.webContents.executeJavaScript(codice, false) : null;
}, [titolo, js]);
const pulsante = (id, testo, js) => `<button id="${id}" style="width:200px;height:60px">${testo}</button><script>document.getElementById('${id}').onclick=function(){${js}}</script>`;

test('«Stampa ricevuta»: la finestra vuota che la pagina apre col clic e riempie è una scheda con la ricevuta', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html(pulsante('b', 'Stampa ricevuta',
    "var w=window.open('');w.document.write('<title>RICEVUTA</title><h1>Ricevuta</h1>');w.document.close();")));
  const prima = (await schede(app)).length;
  await page.click('#b');
  await expect.poll(async () => (await schede(app)).find((s) => s.titolo === 'RICEVUTA')?.attiva, { timeout: 8000 }).toBe(true);
  expect((await schede(app)).length, 'una scheda sola, quella della ricevuta').toBe(prima + 1);
  expect(await nellaScheda(app, 'RICEVUTA', 'document.querySelector("h1").textContent')).toBe('Ricevuta');
});

test('la finestra aperta col clic e portata dopo una risposta all\'indirizzo giusto arriva lì, senza schede bianche', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>REPORT</title>');
  const page = await openTab(testServer.html(pulsante('b', 'Apri il report', `var w=window.open('');setTimeout(function(){w.location=${JSON.stringify(dest)}},800)`)));
  const prima = (await schede(app)).length;
  await page.click('#b');
  await expect.poll(async () => (await schede(app)).some((s) => s.url === dest), { timeout: 8000 }).toBe(true);
  expect((await schede(app)).length).toBe(prima + 1);
});

test('la pagina chiude la finestra che ha aperto, e la sua scheda se ne va', async ({ app, openTab, testServer }) => {
  const aperta = testServer.html('<title>APERTA</title>');
  const page = await openTab(testServer.html(`${pulsante('a', 'Apri', `window.__w=window.open(${JSON.stringify(aperta)})`)}${pulsante('c', 'Chiudi', 'window.__w.close()')}`));
  const prima = (await schede(app)).length;
  await page.click('#a');
  await expect.poll(async () => (await schede(app)).some((s) => s.titolo === 'APERTA'), { timeout: 8000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((x) => x.view.webContents.getURL() === u).id);
  }, page.url());
  await page.click('#c');
  await expect.poll(async () => (await schede(app)).some((s) => s.titolo === 'APERTA'), { timeout: 8000 }).toBe(false);
  expect((await schede(app)).length).toBe(prima);
  expect(await page.evaluate(() => window.__w.closed)).toBe(true);
});

test('la finestra aperta col clic risponde alla pagina che l\'ha aperta', async ({ app, openTab, testServer }) => {
  const aperta = testServer.html('<title>PAGAMENTO</title><script>opener.postMessage("pagato","*")</script>');
  const page = await openTab(testServer.html(`${pulsante('b', 'Paga', `window.open(${JSON.stringify(aperta)})`)}
    <script>window.__esito='';addEventListener('message',function(e){window.__esito=e.data})</script>`));
  await page.click('#b');
  await expect.poll(() => page.evaluate(() => window.__esito), { timeout: 8000 }).toBe('pagato');
});

test('nella finestra tenuta dalla pagina Filo c\'è: da sola non apre schede, col clic sì', async ({ app, openTab, testServer }) => {
  const ad = testServer.html('<title>AD</title>');
  const dalClic = testServer.html('<title>DAL CLIC</title>');
  const aperta = testServer.html(`<title>FIGLIA</title>${pulsante('x', 'apri', `window.open(${JSON.stringify(dalClic)})`)}
    <script>setTimeout(function(){window.open(${JSON.stringify(ad)})},800)</script>`);
  const page = await openTab(testServer.html(pulsante('b', 'Apri', `window.open(${JSON.stringify(aperta)})`)));
  await page.click('#b');
  await expect.poll(async () => (await schede(app)).some((s) => s.titolo === 'FIGLIA'), { timeout: 8000 }).toBe(true);
  await expect.poll(() => nellaScheda(app, 'FIGLIA', 'document.documentElement.dataset.filoReady || ""'), { timeout: 8000 }).toBe('1');
  await page.waitForTimeout(1500);
  expect((await schede(app)).some((s) => s.url === ad), 'da sola non apre').toBe(false);

  const figlia = app.windows().find((w) => { try { return w.url() === aperta; } catch (_) { return false; } });
  await figlia.click('#x');
  await expect.poll(async () => (await schede(app)).some((s) => s.url === dalClic), { timeout: 8000 }).toBe(true);
});

test('la pagina chiude la ricevuta che ha scritto, e Filo resta aperto', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html(`${pulsante('b', 'Stampa', "window.__w=window.open('');window.__w.document.write('<title>RICEVUTA</title>');window.__w.document.close();")}${pulsante('c', 'Chiudi', 'window.__w.close()')}`));
  const prima = (await schede(app)).length;
  await page.click('#b');
  await expect.poll(async () => (await schede(app)).some((s) => s.titolo === 'RICEVUTA'), { timeout: 8000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((x) => x.view.webContents.getURL() === u).id);
  }, page.url());
  await page.click('#c');
  await expect.poll(async () => (await schede(app)).length, { timeout: 8000 }).toBe(prima);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoTabs && !w.isDestroyed()))).toBe(true);
});

// Electron farebbe di window.close() la chiusura della finestra di Filo, da qualunque pagina o riquadro.
test('window.close() di una pagina chiude al più la sua scheda, mai Filo', async ({ app, openTab, testServer }) => {
  const viva = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoTabs && !w.isDestroyed()));
  const riquadro = testServer.html(pulsante('r', 'chiudi dal riquadro', 'window.close()'), { pubblico: true });
  const seconda = testServer.html(`<title>SECONDA</title>${pulsante('c', 'chiudi', 'window.close()')}`);
  const page = await openTab(testServer.html(`<title>PRIMA</title>${pulsante('c', 'chiudi', 'window.close()')}
    <a id="l" href="${seconda}">avanti</a><iframe src="${riquadro}" width="300" height="100"></iframe>`));
  await expect.poll(() => page.frames().some((f) => f.url() === riquadro), { timeout: 8000 }).toBe(true);
  await page.frames().find((f) => f.url() === riquadro).click('#r');
  await page.waitForTimeout(800);
  expect(await viva(), 'un riquadro non chiude Filo').toBe(true);
  expect((await schede(app)).some((s) => s.titolo === 'PRIMA'), 'né la scheda').toBe(true);

  await page.click('#l');
  await expect.poll(async () => (await schede(app)).some((s) => s.titolo === 'SECONDA'), { timeout: 8000 }).toBe(true);
  await page.click('#c');
  await page.waitForTimeout(800);
  expect(await viva()).toBe(true);
  expect((await schede(app)).some((s) => s.titolo === 'SECONDA'), 'con una storia la pagina non si chiude, come in un browser').toBe(true);

  const sola = await openTab(testServer.html(`<title>SOLA</title>${pulsante('c', 'chiudi', 'window.close()')}`));
  await sola.click('#c');
  await expect.poll(async () => (await schede(app)).some((s) => s.titolo === 'SOLA'), { timeout: 8000 }).toBe(false);
  expect(await viva(), 'alla prima pagina si chiude la scheda, non Filo').toBe(true);
});
