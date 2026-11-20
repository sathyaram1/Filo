// #737.8 giro 2: la finestra chiesta per nome col clic torna davanti, anche nelle strade non provate al giro 1.

import { test, expect } from '../../fixtures/electron.mjs';

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const url = (t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } };
  const attiva = tm.tabs.find((t) => t.id === tm.activeId);
  return { attiva: attiva ? url(attiva) : '', schede: tm.tabs.map(url), attivaId: tm.activeId, ids: tm.tabs.map((t) => t.id) };
});

const torna = async (app, shell, page) => {
  const s = await stato(app);
  const id = s.ids[s.schede.findIndex((u) => u === page.url())];
  await shell.evaluate((i) => window.filoShell.tabs.activate(i), id);
  await expect.poll(async () => (await stato(app)).attiva).toBe(page.url());
  await page.waitForTimeout(400);
};

const q = (s) => JSON.stringify(s).replace(/"/g, '&quot;');

test('Ctrl+clic su un pulsante che apre una finestra per nome: resta dietro, il clic dopo la porta davanti', async ({ app, shell, openTab, testServer }) => {
  const uno = testServer.html('<title>UNO</title>');
  const due = testServer.html('<title>DUE</title>');
  const page = await openTab(testServer.html(`<button id="a" style="height:40px" onclick="window.open(${q(uno)},'aiuto')">uno</button>
    <button id="b" style="height:40px" onclick="window.open(${q(due)},'aiuto')">due</button>`));
  await page.click('#a', { modifiers: ['Control'] });
  await expect.poll(async () => (await stato(app)).schede.includes(uno), { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(1000);
  expect((await stato(app)).attiva).toBe(page.url());
  await page.click('#b');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(due);
});

test('pagamento su un altro sito riportato davanti con focus', async ({ app, shell, openTab, testServer }) => {
  const paga = testServer.html('<title>PAGA</title>', { pubblico: true });
  const page = await openTab(testServer.html(`<script>var w=null;function apri(){if(w&&!w.closed){w.focus();}else{w=window.open(${JSON.stringify(paga)},'pagamento','width=500,height=600');}}</script>
    <button id="a" style="height:40px" onclick="apri()">paga</button>`));
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(paga);
  await torna(app, shell, page);
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(paga);
});

test('collegamenti con nome dentro un riquadro: il secondo porta davanti', async ({ app, shell, openTab, testServer }) => {
  const uno = testServer.html('<title>UNO</title>');
  const due = testServer.html('<title>DUE</title>');
  const menu = testServer.html(`<a id="a" href="${uno}" target="_new" style="display:block;height:40px">uno</a>
    <a id="b" href="${due}" target="_new" style="display:block;height:40px">due</a>`);
  const page = await openTab(testServer.html(`<iframe id="f" src="${menu}" style="width:400px;height:200px"></iframe>`));
  const f = page.frameLocator('#f');
  await f.locator('#a').click();
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(uno);
  await torna(app, shell, page);
  await f.locator('#b').click();
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(due);
});

test('ancore con nome dentro un riquadro: il secondo argomento porta davanti', async ({ app, shell, openTab, testServer }) => {
  const aiuto = testServer.html('<title>AIUTO</title><h1 id="uno">uno</h1><div style="height:3000px"></div><h1 id="due">due</h1>');
  const menu = testServer.html(`<a id="a" href="${aiuto}#uno" target="aiuto" style="display:block;height:40px">uno</a>
    <a id="b" href="${aiuto}#due" target="aiuto" style="display:block;height:40px">due</a>`);
  const page = await openTab(testServer.html(`<iframe id="f" src="${menu}" style="width:400px;height:200px"></iframe>`));
  const f = page.frameLocator('#f');
  await f.locator('#a').click();
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(`${aiuto}#uno`);
  await torna(app, shell, page);
  await f.locator('#b').click();
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(`${aiuto}#due`);
});

test('Invio da tastiera sul secondo collegamento con nome porta davanti', async ({ app, shell, openTab, testServer }) => {
  const uno = testServer.html('<title>UNO</title>');
  const due = testServer.html('<title>DUE</title>');
  const page = await openTab(testServer.html(`<a id="a" href="${uno}" target="_new" style="display:block;height:40px">uno</a>
    <a id="b" href="${due}" target="_new" style="display:block;height:40px">due</a>`));
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(uno);
  await torna(app, shell, page);
  await page.focus('#b');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(due);
});

test('ancora da tastiera: Invio sul secondo argomento porta davanti', async ({ app, shell, openTab, testServer }) => {
  const aiuto = testServer.html('<title>AIUTO</title><h1 id="uno">uno</h1><div style="height:3000px"></div><h1 id="due">due</h1>');
  const page = await openTab(testServer.html(`<a id="a" href="${aiuto}#uno" target="aiuto" style="display:block;height:40px">uno</a>
    <a id="b" href="${aiuto}#due" target="aiuto" style="display:block;height:40px">due</a>`));
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(`${aiuto}#uno`);
  await torna(app, shell, page);
  await page.focus('#b');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(`${aiuto}#due`);
});

test('pagina che apre la finestra dopo un attimo di attesa (caricamento): torna davanti', async ({ app, shell, openTab, testServer }) => {
  const uno = testServer.html('<title>UNO</title>');
  const due = testServer.html('<title>DUE</title>');
  const page = await openTab(testServer.html(`<button id="a" style="height:40px" onclick="window.open(${q(uno)},'aiuto')">uno</button>
    <button id="b" style="height:40px" onclick="setTimeout(function(){window.open(${q(due)},'aiuto')},1500)">due</button>`));
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(uno);
  await torna(app, shell, page);
  await page.click('#b');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(due);
});

test('due schede dello stesso sito: la seconda non riempie la finestra della prima', async ({ app, shell, openTab, testServer }) => {
  const uno = testServer.html('<title>UNO</title>');
  const due = testServer.html('<title>DUE</title>');
  const a = await openTab(testServer.html(`<a id="a" href="${uno}" target="_new" style="display:block;height:40px">uno</a>`));
  await a.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(uno);
  const b = await openTab(testServer.html(`<a id="b" href="${due}" target="_new" style="display:block;height:40px">due</a>`));
  await expect.poll(async () => (await stato(app)).attiva).toBe(b.url());
  await b.waitForTimeout(400);
  await b.click('#b');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(due);
  expect((await stato(app)).schede.includes(uno)).toBe(true);
});

test('finestra chiusa dall\'utente: il clic dopo ne apre una davanti', async ({ app, shell, openTab, testServer }) => {
  const uno = testServer.html('<title>UNO</title>');
  const due = testServer.html('<title>DUE</title>');
  const page = await openTab(testServer.html(`<a id="a" href="${uno}" target="_new" style="display:block;height:40px">uno</a>
    <a id="b" href="${due}" target="_new" style="display:block;height:40px">due</a>`));
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(uno);
  const s = await stato(app);
  await shell.evaluate((i) => window.filoShell.tabs.close(i), s.attivaId);
  await expect.poll(async () => (await stato(app)).attiva).toBe(page.url());
  await page.waitForTimeout(400);
  await page.click('#b');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(due);
});
