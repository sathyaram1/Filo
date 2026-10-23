// Verifica #1343 giro 6, rilievo 2: le azioni sulla pagina della barra laterale, dove la pagina non ha (ancora) Filo
// dentro, o fanno quello che dicono o si mostrano spente dicendo perché. Mai un clic che non fa niente.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { barraPage, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';
async function iconaDellaBarra(app, id) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const ico = barra.locator(`#nav .ico[data-id="${id}"]`);
  if (!(await ico.count())) await barra.locator('#nav [data-altro]').click();
  return ico;
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = '<!doctype html><html><head><title>Prima</title></head><body><h1>Prima</h1></body></html>';
const naviga = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.navigate(w._filoTabs.activeId, url);
}, u);
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());

async function condividiFunzionaODiceDiNo(app, voluto, attesa) {
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  const share = await iconaDellaBarra(app, 'share');
  if ((await share.getAttribute('aria-disabled')) === 'true') {
    expect(await share.getAttribute('data-sugg'), 'spenta, dice perché').toBeTruthy();
    return;
  }
  await share.click();
  await expect.poll(() => appunti(app), { timeout: attesa, message: 'Condividi accesa: l\'indirizzo arriva negli appunti' }).toBe(voluto);
}

test('r2 su un PDF Condividi della barra copia l\'indirizzo, o si mostra spenta dicendo perché', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const url = testServer.asset(readFileSync('tests/fixtures/documenti/documento-con-testo.pdf'), 'application/pdf');
  await naviga(app, url);
  await pausa(3000);
  await condividiFunzionaODiceDiNo(app, url, 4000);
});

test('r2 su una pagina che si sta ancora caricando Condividi della barra non si perde', async ({ app, openTab, testServer }) => {
  const lento = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write('<!doctype html><title>Lenta</title><h1>Arriva…</h1>' + ' '.repeat(4096));
    setTimeout(() => res.end('<p>finita</p>'), 6000);
  });
  await new Promise((r) => lento.listen(0, '127.0.0.1', r));
  try {
    await testServer.openReady(openTab, SITO);
    const url = `http://127.0.0.1:${lento.address().port}/lenta`;
    await naviga(app, url);
    await pausa(1500);
    // Il clic arriva a pagina ancora in arrivo: va fatto adesso, o appena la pagina c'è.
    await condividiFunzionaODiceDiNo(app, url, 10_000);
  } finally {
    lento.close();
  }
});
