// L'icona "Home" della barra laterale deve portare la scheda CORRENTE alla
// home di Filo (la newtab/dashboard) — non aprire la pagina "Aperti per dopo"
// (filo://home/home.html) né lasciarti sulla pagina attuale. Regressione
// feedback #211.

import { test, expect } from './fixtures/electron.mjs';
import { iconaDellaBarra } from './helpers/barra.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1>
  <p>Click destro qui per aprire il menu Filo.</p>
</body></html>`;

test('click su Home naviga la scheda corrente alla home, non apre "Aperti per dopo"', async ({ openTab, testServer, app }) => {
  const page = await testServer.openReady(openTab, HTML);
  const pageUrl = page.url(); // la pagina http su cui siamo ora
  const schede = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.tabs.length);
  const quante = await schede();
  await (await iconaDellaBarra(app, 'home')).click();

  // Atteso: la scheda corrente lascia la pagina http e diventa la home di Filo
  // (filo://newtab/). NON deve restare sulla pagina attuale, NÉ deve aprirsi la
  // pagina "Aperti per dopo" (filo://home/home.html).
  const deadline = Date.now() + 6_000;
  let ok = false;
  let lastUrls = [];
  while (Date.now() < deadline) {
    const urls = app.windows().map((w) => { try { return w.url(); } catch (_) { return ''; } });
    lastUrls = urls;
    const stillOnCurrentPage = urls.includes(pageUrl);
    const openedForLater = urls.some((u) => u.startsWith('filo://home/'));
    const homeReached = urls.some((u) => u.startsWith('filo://newtab/'));
    if (!stillOnCurrentPage && !openedForLater && homeReached) { ok = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(
    ok,
    `Home deve navigare la scheda corrente a filo://newtab/ senza restare sulla pagina attuale né aprire "Aperti per dopo". Finestre viste: ${JSON.stringify(lastUrls)}`,
  ).toBe(true);
  // La stessa scheda, non una nuova accanto.
  expect(await schede()).toBe(quante);
});
