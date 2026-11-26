// Verifica #2659 giro 1: la finestra di un altro sito tenuta dalla pagina, chiusa, non lascia schede morte.
import { test, expect } from '../../fixtures/electron.mjs';

const tm = 'BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs';
const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const m = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return m.tabs.map((t) => {
    try { return { id: t.id, morta: t.view.webContents.isDestroyed(), url: t.view.webContents.getURL(), titolo: t.view.webContents.getTitle(), attiva: t.id === m.activeId }; } catch (_) { return { id: t.id, morta: true, url: '', titolo: '', attiva: t.id === m.activeId }; }
  });
});
const davanti = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const m = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  m.activate(m.tabs.find((x) => x.view.webContents.getURL() === url).id);
}, u);
const pulsante = (id, testo, js) => `<button id="${id}" style="width:200px;height:60px">${testo}</button><script>document.getElementById('${id}').onclick=function(){${js}}</script>`;
const nessunaMorta = async (app, prima) => {
  await expect.poll(async () => (await schede(app)).length, { timeout: 8000 }).toBe(prima);
  const s = await schede(app);
  expect(s.filter((x) => x.morta), 'nessuna scheda col contenuto distrutto').toEqual([]);
  expect(s.some((x) => x.attiva), 'resta una scheda davanti').toBe(true);
};
void tm;

test('la finestra di pagamento di un altro sito si chiude da sola e la sua scheda se ne va', async ({ app, openTab, testServer }) => {
  const dest = testServer.html(`<title>PAGA</title>${pulsante('p', 'Paga', 'setTimeout(function(){window.close()},100)')}`, { pubblico: true });
  const page = await openTab(testServer.html(`<title>NEGOZIO</title>${pulsante('a', 'Apri', `window.__w=window.open(${JSON.stringify(dest)},'paga')`)}`));
  const prima = (await schede(app)).length;
  await page.click('#a');
  await expect.poll(async () => (await schede(app)).find((s) => s.titolo === 'PAGA')?.attiva, { timeout: 8000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const m = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = m.tabs.find((x) => x.view.webContents.getTitle() === 'PAGA');
    return t.view.webContents.executeJavaScript('document.getElementById("p").click()', true);
  });
  await expect.poll(() => page.evaluate(() => window.__w.closed), { timeout: 8000 }).toBe(true);
  await nessunaMorta(app, prima);
});

test('la finestra aperta sullo stesso sito, passata a un altro sito, chiusa dalla pagina se ne va', async ({ app, openTab, testServer }) => {
  const fuori = testServer.html('<title>FUORI</title>', { pubblico: true });
  const dentro = testServer.html(`<title>DENTRO</title><script>setTimeout(function(){location=${JSON.stringify(fuori)}},300)</script>`);
  const page = await openTab(testServer.html(`<title>NEGOZIO</title>${pulsante('a', 'Apri', `window.__w=window.open(${JSON.stringify(dentro)},'chat')`)}${pulsante('c', 'Chiudi', 'window.__w.close()')}`));
  const prima = (await schede(app)).length;
  await page.click('#a');
  await expect.poll(async () => (await schede(app)).some((s) => s.titolo === 'FUORI'), { timeout: 8000 }).toBe(true);
  await davanti(app, page.url());
  await page.click('#c');
  await expect.poll(() => page.evaluate(() => window.__w.closed), { timeout: 8000 }).toBe(true);
  await nessunaMorta(app, prima);
});

test('la finestra di un altro sito che torna sul sito della pagina, chiusa dalla pagina, se ne va', async ({ app, openTab, testServer }) => {
  const ritorno = testServer.html('<title>RITORNO</title>');
  const fuori = testServer.html(`<title>FUORI</title><script>setTimeout(function(){location=${JSON.stringify(ritorno)}},300)</script>`, { pubblico: true });
  const page = await openTab(testServer.html(`<title>NEGOZIO</title>${pulsante('a', 'Apri', `window.__w=window.open(${JSON.stringify(fuori)},'chat')`)}${pulsante('c', 'Chiudi', 'window.__w.close()')}`));
  const prima = (await schede(app)).length;
  await page.click('#a');
  await expect.poll(async () => (await schede(app)).some((s) => s.titolo === 'RITORNO'), { timeout: 8000 }).toBe(true);
  await davanti(app, page.url());
  await page.click('#c');
  await expect.poll(() => page.evaluate(() => window.__w.closed), { timeout: 8000 }).toBe(true);
  await nessunaMorta(app, prima);
});

test('la finestra di un altro sito chiusa dalla pagina mentre è lei la scheda davanti se ne va', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>CHAT</title>', { pubblico: true });
  const page = await openTab(testServer.html(`<title>NEGOZIO</title>${pulsante('a', 'Apri', `window.__w=window.open(${JSON.stringify(dest)},'chat');setTimeout(function(){window.__w.close()},2500)`)}`));
  const prima = (await schede(app)).length;
  await page.click('#a');
  await expect.poll(async () => (await schede(app)).find((s) => s.titolo === 'CHAT')?.attiva, { timeout: 8000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__w.closed), { timeout: 8000 }).toBe(true);
  await nessunaMorta(app, prima);
  expect((await schede(app)).find((s) => s.attiva)?.titolo).toBe('NEGOZIO');
});

test('la stessa finestra per nome portata a un altro sito e poi chiusa se ne va, e riaprirla funziona', async ({ app, openTab, testServer }) => {
  const uno = testServer.html('<title>UNO</title>');
  const due = testServer.html('<title>DUE</title>', { pubblico: true });
  const page = await openTab(testServer.html(`<title>NEGOZIO</title>${pulsante('a', 'Uno', `window.__w=window.open(${JSON.stringify(uno)},'chat')`)}${pulsante('b', 'Due', `window.__w=window.open(${JSON.stringify(due)},'chat')`)}${pulsante('c', 'Chiudi', 'window.__w.close()')}`));
  const prima = (await schede(app)).length;
  await page.click('#a');
  await expect.poll(async () => (await schede(app)).some((s) => s.titolo === 'UNO'), { timeout: 8000 }).toBe(true);
  await davanti(app, page.url());
  await page.click('#b');
  await expect.poll(async () => (await schede(app)).some((s) => s.titolo === 'DUE'), { timeout: 8000 }).toBe(true);
  expect((await schede(app)).length).toBe(prima + 1);
  await davanti(app, page.url());
  await page.click('#c');
  await expect.poll(() => page.evaluate(() => window.__w.closed), { timeout: 8000 }).toBe(true);
  await nessunaMorta(app, prima);
  await page.click('#b');
  await expect.poll(async () => (await schede(app)).some((s) => s.titolo === 'DUE' && !s.morta), { timeout: 8000 }).toBe(true);
  expect((await schede(app)).length).toBe(prima + 1);
});

test('due finestre di altri siti chiuse insieme se ne vanno tutte e due', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<title>A</title>', { pubblico: true });
  const b = testServer.html('<title>B</title>', { pubblico: true });
  const page = await openTab(testServer.html(`<title>NEGOZIO</title>${pulsante('a', 'Apri', `window.__a=window.open(${JSON.stringify(a)},'a');window.__b=window.open(${JSON.stringify(b)},'b')`)}${pulsante('c', 'Chiudi', 'window.__a.close();window.__b.close()')}`));
  const prima = (await schede(app)).length;
  await page.click('#a');
  await expect.poll(async () => (await schede(app)).filter((s) => s.titolo === 'A' || s.titolo === 'B').length, { timeout: 8000 }).toBe(2);
  await davanti(app, page.url());
  await page.click('#c');
  await nessunaMorta(app, prima);
});
