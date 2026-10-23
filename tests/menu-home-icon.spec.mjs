// L'icona Home della barra laterale porta la scheda CORRENTE alla home di Filo (filo://newtab/): non apre «Aperti per
// dopo» (filo://home/home.html) e non lascia sulla pagina di prima. Regressione feedback #211.

import { test, expect } from './fixtures/electron.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1>
  <p>Una pagina qualunque.</p>
</body></html>`;

test('click su Home naviga la scheda corrente alla home, non apre "Aperti per dopo"', async ({ openTab, testServer, app }) => {
  const page = await testServer.openReady(openTab, HTML);
  const pageUrl = page.url();
  await premiNellaBarra(app, 'home');

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
});
