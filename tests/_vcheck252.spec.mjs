import { test, expect } from './fixtures/electron.mjs';

// Verifica black-box #252: una sola scheda per pagina interna (anche via forma
// legacy lunga), niente doppioni riaprendo, newtab resta duplicabile.

async function tabUrls(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return win ? win._filoTabs.tabs.map((t) => t.url) : [];
  });
}
async function openInApp(shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await new Promise((r) => setTimeout(r, 500));
}

test('#252 pagina interna: indirizzo unico + niente doppioni', async ({ app, shell }) => {
  // Apertura "menu App" (forma corta)
  await openInApp(shell, 'filo://home/home.html');
  // Apertura "Impostazioni/Cronologia" storica (forma lunga legacy)
  await openInApp(shell, 'filo://src/pages/home/home.html');
  // Terzo click a lista già aperta
  await openInApp(shell, 'filo://home/home.html');

  let urls = await tabUrls(app);
  const homeCount = urls.filter((u) => u.includes('home/home.html')).length;
  expect(homeCount, `home aperto ${homeCount} volte, atteso 1. urls=${JSON.stringify(urls)}`).toBe(1);
  // Nessuna scheda deve avere la forma lunga legacy
  expect(urls.some((u) => u.includes('src/pages'))).toBe(false);

  // Pagina interna diversa → scheda separata
  await openInApp(shell, 'filo://history/history.html');
  urls = await tabUrls(app);
  expect(urls.filter((u) => u.includes('history/history.html')).length).toBe(1);
  expect(urls.filter((u) => u.includes('home/home.html')).length).toBe(1);

  // ?highlight riusa la stessa scheda (non un doppione) e rinaviga
  await openInApp(shell, 'filo://home/home.html?highlight=abc');
  urls = await tabUrls(app);
  expect(urls.filter((u) => u.includes('home/home.html')).length).toBe(1);
  expect(urls.some((u) => u.includes('highlight=abc'))).toBe(true);
});

test('#252 newtab resta duplicabile', async ({ app, shell }) => {
  const before = (await tabUrls(app)).filter((u) => u.includes('newtab')).length;
  await openInApp(shell, 'filo://newtab/');
  await openInApp(shell, 'filo://newtab/');
  const after = (await tabUrls(app)).filter((u) => u.includes('newtab')).length;
  expect(after, `newtab prima=${before} dopo=${after}, attesi +2`).toBe(before + 2);
});
