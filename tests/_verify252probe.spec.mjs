// SONDA #252 — casi limite, solo osservazione del comportamento reale.
import { test, expect } from './fixtures/electron.mjs';

async function tabUrls(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return win ? win._filoTabs.tabs.map((t) => t.url) : [];
  });
}
async function open(shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await new Promise((r) => setTimeout(r, 400));
}

test('sonda: forme alternative dello stesso indirizzo', async ({ app, shell }) => {
  await open(shell, 'filo://home/home.html');
  await open(shell, 'filo://home/');
  await open(shell, 'filo://home');
  await open(shell, 'filo://HOME/home.html');
  await open(shell, 'filo://home/./home.html');
  console.log('SONDA-ALTFORM', JSON.stringify(await tabUrls(app), null, 1));
});

test('sonda: due editor (documenti diversi) dal menu', async ({ app, shell }) => {
  await open(shell, 'filo://editor/editor.html');
  await open(shell, 'filo://editor/editor.html');
  console.log('SONDA-EDITOR', JSON.stringify(await tabUrls(app), null, 1));
});

test('sonda: link filo:// cliccato dentro una pagina web esterna', async ({ app, shell, testServer, openTab }) => {
  await open(shell, 'filo://home/home.html');
  const page = await testServer.openReady(openTab, '<a id="l" href="filo://home/home.html">vai</a>');
  await page.click('#l').catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  console.log('SONDA-LINKWEB', JSON.stringify(await tabUrls(app), null, 1));
});

test('sonda: ripristino sessione con due schede interne uguali salvate', async ({ app, shell }) => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win._filoTabs.openTab('filo://home/home.html', { activate: false });
    win._filoTabs.openTab('filo://home/home.html', { activate: false });
  });
  await new Promise((r) => setTimeout(r, 600));
  console.log('SONDA-RESTORE', JSON.stringify(await tabUrls(app), null, 1));
});
