// #737.8 giro 1 — la finestra che la pagina chiede per nome, chiesta di nuovo col clic, torna davanti.

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

test('target con nome: il secondo clic porta davanti la finestra con la seconda pagina', async ({ app, shell, openTab, testServer }) => {
  const uno = testServer.html('<title>UNO</title>');
  const due = testServer.html('<title>DUE</title>');
  const page = await openTab(testServer.html(`<a id="a" href="${uno}" target="_new" style="display:block;height:40px">uno</a>
    <a id="b" href="${due}" target="_new" style="display:block;height:40px">due</a>`));
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(uno);
  await torna(app, shell, page);
  await page.click('#b');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(due);
  const s = await stato(app);
  expect(s.schede.filter((u) => u === due).length).toBe(1);
  expect(s.schede.includes(uno)).toBe(false);
});

test('r1 finestra già aperta riportata davanti dalla pagina (focus): il secondo clic porta davanti', async ({ app, shell, openTab, testServer }) => {
  const uno = testServer.html('<title>UNO</title>');
  const page = await openTab(testServer.html(`<script>var w=null;function apri(){if(w&&!w.closed){w.focus();}else{w=window.open(${JSON.stringify(uno)},'aiuto');}}</script>
    <button id="a" style="height:40px" onclick="apri()">aiuto</button>`));
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(uno);
  await torna(app, shell, page);
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(uno);
});

test('window.open con lo stesso nome: il secondo pulsante porta davanti', async ({ app, shell, openTab, testServer }) => {
  const uno = testServer.html('<title>UNO</title>');
  const due = testServer.html('<title>DUE</title>');
  const page = await openTab(testServer.html(`<button id="a" style="height:40px" onclick="window.open(${q(uno)},'aiuto','width=400,height=300')">uno</button>
    <button id="b" style="height:40px" onclick="window.open(${q(due)},'aiuto','width=400,height=300')">due</button>`));
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(uno);
  await torna(app, shell, page);
  await page.click('#b');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(due);
});

test('r1 aiuto con le ancore: il secondo argomento della stessa pagina porta davanti', async ({ app, shell, openTab, testServer }) => {
  const aiuto = testServer.html('<title>AIUTO</title><h1 id="uno">uno</h1><div style="height:3000px"></div><h1 id="due">due</h1>');
  const page = await openTab(testServer.html(`<a id="a" href="${aiuto}#uno" target="aiuto" style="display:block;height:40px">uno</a>
    <a id="b" href="${aiuto}#due" target="aiuto" style="display:block;height:40px">due</a>`));
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(`${aiuto}#uno`);
  await torna(app, shell, page);
  await page.click('#b');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(`${aiuto}#due`);
});

test('r1 anteprima scritta dalla pagina: il secondo clic porta davanti la finestra riscritta', async ({ app, shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<script>function anteprima(t){var w=window.open('','anteprima');w.document.open();w.document.write('<title>'+t+'</title><p>'+t+'</p>');w.document.close();w.focus();}</script>
    <button id="a" style="height:40px" onclick="anteprima('PRIMA')">uno</button>
    <button id="b" style="height:40px" onclick="anteprima('SECONDA')">due</button>`));
  const s0 = await stato(app);
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).schede.length, { timeout: 8000 }).toBe(s0.schede.length + 1);
  await expect.poll(async () => (await stato(app)).attivaId, { timeout: 8000 }).not.toBe(s0.attivaId);
  const finestra = (await stato(app)).attivaId;
  await torna(app, shell, page);
  await page.click('#b');
  await expect.poll(async () => (await stato(app)).attivaId, { timeout: 8000 }).toBe(finestra);
});

test('modulo con target con nome: il secondo invio porta davanti', async ({ app, shell, openTab, testServer }) => {
  const dest = testServer.html('<title>DEST</title>');
  const page = await openTab(testServer.html(`<form action="${dest}" method="get" target="_new"><input name="q" id="q"><button id="s" style="height:40px">vai</button></form>`));
  await page.fill('#q', 'uno');
  await page.click('#s');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(`${dest}?q=uno`);
  await torna(app, shell, page);
  await page.fill('#q', 'due');
  await page.click('#s');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(`${dest}?q=due`);
});

test('Ctrl+clic sul secondo collegamento con nome non porta via dalla pagina', async ({ app, shell, openTab, testServer }) => {
  const uno = testServer.html('<title>UNO</title>');
  const due = testServer.html('<title>DUE</title>');
  const page = await openTab(testServer.html(`<a id="a" href="${uno}" target="_new" style="display:block;height:40px">uno</a>
    <a id="b" href="${due}" target="_new" style="display:block;height:40px">due</a>`));
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(uno);
  await torna(app, shell, page);
  await page.click('#b', { modifiers: ['Control'] });
  await expect.poll(async () => (await stato(app)).schede.includes(due), { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(800);
  expect((await stato(app)).attiva).toBe(page.url());
});

test('senza clic la pagina che riempie la finestra per nome non la porta davanti', async ({ app, shell, openTab, testServer }) => {
  const uno = testServer.html('<title>UNO</title>');
  const due = testServer.html('<title>DUE</title>');
  const page = await openTab(testServer.html(`<a id="a" href="${uno}" target="_new" style="display:block;height:40px">uno</a>
    <script>document.getElementById('a').addEventListener('click',function(){setTimeout(function(){window.open(${JSON.stringify(due)},'_new')},7000)})</script>`));
  await page.click('#a');
  await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(uno);
  await torna(app, shell, page);
  await expect.poll(async () => (await stato(app)).schede.includes(due), { timeout: 12000 }).toBe(true);
  await page.waitForTimeout(800);
  expect((await stato(app)).attiva).toBe(page.url());
});
