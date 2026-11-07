// Feedback 31C6: la finestra in incognito si apre anche da un'icona, non solo da Impostazioni. L'icona c'è fra quelle
// in vista della barra laterale (nella disposizione di partenza nessuno la vedeva) e cliccata apre davvero l'incognito.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1>
  <p>Una pagina qualunque.</p>
</body></html>`;

async function barraAperta(app) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  return barra;
}

test("l'icona incognito è fra le icone in vista della barra laterale", async ({ openTab, testServer, app }) => {
  await testServer.openReady(openTab, HTML);
  const barra = await barraAperta(app);
  await expect(barra.locator('#nav .ico[data-id="incognito"]:not(.riserva)')).toBeVisible();
});

test("cliccando l'icona incognito si apre una finestra incognito", async ({ openTab, testServer, app }) => {
  await testServer.openReady(openTab, HTML);
  const barra = await barraAperta(app);
  await barra.locator('#nav .ico[data-id="incognito"]').click();

  // La finestra incognito carica filo://shell/shell.html?incognito=1.
  const deadline = Date.now() + 5_000;
  let found = false;
  while (Date.now() < deadline) {
    found = app.windows().some((w) => w.url().includes('incognito=1'));
    if (found) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(found, 'finestra incognito non aperta dopo click sull\'icona').toBe(true);
});
