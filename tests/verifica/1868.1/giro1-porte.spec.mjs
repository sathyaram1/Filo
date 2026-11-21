// #1868.1 giro 1 — gesti subito dopo il crollo di una scheda: le porte vicine a Ricarica e Indietro.
import { test, expect } from '../../fixtures/electron.mjs';

// La scheda su `url` cade; si torna appena il main la sa caduta, prima della rimessa in piedi (300 ms).
async function crolla(app, url) {
  return app.evaluate(async ({ BrowserWindow }, target) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tab = w._filoTabs.tabs.find((t) => t.view.webContents.getURL() === target);
    const wc = tab.view.webContents;
    process.kill(wc.getOSProcessId(), 'SIGKILL');
    for (let i = 0; i < 200 && !wc.isCrashed(); i++) await new Promise((r) => setTimeout(r, 10));
    return tab.id;
  }, url);
}

const gesto = (app, id, nome, ...resto) => app.evaluate(({ BrowserWindow }, [i, n, r]) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs[n](i, ...r);
}, [id, nome, resto]);

// Cosa mostra la scheda `id`: indirizzo e titolo della pagina in una vista viva, e l'indirizzo della barra.
const mostra = (app, id) => app.evaluate(async ({ BrowserWindow }, i) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const tab = w._filoTabs.tabs.find((t) => t.id === i);
  if (!tab || tab.view.webContents.isCrashed()) return '';
  const titolo = await tab.view.webContents.executeJavaScript('document.title').catch(() => '');
  return `${tab.view.webContents.getURL()} ${titolo} | ${tab.url}`;
}, id);

const paginaCaduta = (app) => app.windows().some((p) => { try { return p.url().startsWith('filo://error/'); } catch (_) { return false; } });
const oltreLaRimessa = () => new Promise((r) => setTimeout(r, 1500));

async function dueSiti(app, openTab, testServer) {
  const prima = testServer.html('<!DOCTYPE html><title>prima</title><p>uno</p>');
  const dopo = testServer.html('<!DOCTYPE html><title>dopo</title><p>due</p>');
  await openTab(prima);
  const id = await app.evaluate(({ BrowserWindow }, [da, verso]) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tab = w._filoTabs.tabs.find((t) => t.view.webContents.getURL() === da);
    w._filoTabs.navigate(tab.id, verso);
    return tab.id;
  }, [prima, dopo]);
  await expect.poll(() => mostra(app, id), { timeout: 10_000 }).toBe(`${dopo} dopo | ${dopo}`);
  return { prima, dopo, id };
}

test('Avanti subito dopo il crollo porta alla pagina successiva', async ({ app, openTab, testServer }) => {
  const { prima, dopo, id } = await dueSiti(app, openTab, testServer);
  await gesto(app, id, 'goBack');
  await expect.poll(() => mostra(app, id), { timeout: 10_000 }).toBe(`${prima} prima | ${prima}`);
  await crolla(app, prima);
  await gesto(app, id, 'goForward');
  await oltreLaRimessa();
  await expect.poll(() => mostra(app, id), { timeout: 10_000 }).toBe(`${dopo} dopo | ${dopo}`);
  expect(paginaCaduta(app)).toBe(false);
});

test('Ricarica subito dopo il crollo tiene la strada del ritorno: Indietro torna alla pagina di prima', async ({ app, openTab, testServer }) => {
  const { prima, dopo, id } = await dueSiti(app, openTab, testServer);
  await crolla(app, dopo);
  await gesto(app, id, 'reload');
  await oltreLaRimessa();
  await expect.poll(() => mostra(app, id), { timeout: 10_000 }).toBe(`${dopo} dopo | ${dopo}`);
  await gesto(app, id, 'goBack');
  await expect.poll(() => mostra(app, id), { timeout: 10_000 }).toBe(`${prima} prima | ${prima}`);
  await gesto(app, id, 'goForward');
  await expect.poll(() => mostra(app, id), { timeout: 10_000 }).toBe(`${dopo} dopo | ${dopo}`);
});

test('Ricarica premuta due volte di fila subito dopo il crollo apre il sito', async ({ app, openTab, testServer }) => {
  const { dopo, id } = await dueSiti(app, openTab, testServer);
  await crolla(app, dopo);
  await gesto(app, id, 'reload');
  await gesto(app, id, 'reload');
  await oltreLaRimessa();
  await expect.poll(() => mostra(app, id), { timeout: 10_000 }).toBe(`${dopo} dopo | ${dopo}`);
  expect(paginaCaduta(app)).toBe(false);
});

test('Ricarica dal tasto della barra, subito dopo il crollo, apre il sito', async ({ app, shell, openTab, testServer }) => {
  const { dopo, id } = await dueSiti(app, openTab, testServer);
  await crolla(app, dopo);
  await shell.evaluate((i) => window.filoShell.tabs.reload(i), id);
  await oltreLaRimessa();
  await expect.poll(() => mostra(app, id), { timeout: 10_000 }).toBe(`${dopo} dopo | ${dopo}`);
  expect(paginaCaduta(app)).toBe(false);
});

test('Indietro dal tasto della barra, subito dopo il crollo, torna alla pagina di prima', async ({ app, shell, openTab, testServer }) => {
  const { prima, dopo, id } = await dueSiti(app, openTab, testServer);
  await crolla(app, dopo);
  await shell.evaluate((i) => window.filoShell.tabs.back(i), id);
  await oltreLaRimessa();
  await expect.poll(() => mostra(app, id), { timeout: 10_000 }).toBe(`${prima} prima | ${prima}`);
  expect(paginaCaduta(app)).toBe(false);
});

test('Indietro subito dopo il crollo verso una pagina di Filo la riapre', async ({ app, openTab, testServer }) => {
  const sito = testServer.html('<!DOCTYPE html><title>sito</title><p>uno</p>');
  await openTab('filo://newtab/');
  const id = await app.evaluate(({ BrowserWindow }, verso) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tab = w._filoTabs.tabs.find((t) => t.view.webContents.getURL().startsWith('filo://newtab'));
    w._filoTabs.navigate(tab.id, verso);
    return tab.id;
  }, sito);
  await expect.poll(() => mostra(app, id), { timeout: 10_000 }).toBe(`${sito} sito | ${sito}`);
  await crolla(app, sito);
  await gesto(app, id, 'goBack');
  await oltreLaRimessa();
  await expect.poll(async () => (await mostra(app, id)).startsWith('filo://newtab'), { timeout: 10_000 }).toBe(true);
  expect(paginaCaduta(app)).toBe(false);
});
