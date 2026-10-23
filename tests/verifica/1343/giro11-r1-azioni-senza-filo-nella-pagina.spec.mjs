// Verifica #1343 giro 11, rilievo 1: un'azione sulla pagina della barra laterale fa quello che dice sulla pagina che
// l'utente vede, o si mostra spenta dicendo perché. Mai un clic che non fa niente, mai l'indirizzo interno di Filo.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { barraPage, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = '<!doctype html><html><head><title>Prima</title></head><body><h1>Prima</h1></body></html>';
const DALLE_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };
const imposta = (app, s) => app.evaluate(async (_e, a) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: a.s }, a.da), { s, da: DALLE_PREFERENZE });
const naviga = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  tm.navigate(tm.activeId, url);
}, u);
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());

async function icona(app, id) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const ico = barra.locator(`#nav .ico[data-id="${id}"]`);
  if (!(await ico.count())) await barra.locator('#nav [data-altro]').click();
  return ico;
}

// `voluto` null: sulla pagina non c'è un indirizzo da condividere, l'icona deve dirlo.
async function condividiFaODiceDiNo(app, voluto, attesa = 5000) {
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  const share = await icona(app, 'share');
  if ((await share.getAttribute('aria-disabled')) === 'true') {
    expect(await share.getAttribute('data-sugg'), 'spenta, dice perché').toBeTruthy();
    return;
  }
  expect(voluto, 'qui non c\'è un indirizzo da condividere: Condividi doveva mostrarsi spenta').not.toBeNull();
  await share.click();
  await expect.poll(() => appunti(app), { timeout: attesa, message: 'Condividi accesa: l\'indirizzo della pagina arriva negli appunti' }).toBe(voluto);
}

test('r1 su un sito dove Filo è spento Condividi della barra copia l\'indirizzo, o si mostra spenta dicendo perché', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await imposta(app, { blocklist: [new URL(page.url()).hostname] });
  await pausa(1500);
  await condividiFaODiceDiNo(app, page.url());
});

test('r1 su un PDF Condividi della barra copia l\'indirizzo, o si mostra spenta dicendo perché', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const url = testServer.asset(readFileSync('tests/fixtures/documenti/documento-con-testo.pdf'), 'application/pdf');
  await naviga(app, url);
  await pausa(3000);
  await condividiFaODiceDiNo(app, url);
});

test('r1 su una pagina che si sta ancora caricando Condividi della barra non si perde', async ({ app, openTab, testServer }) => {
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
    await condividiFaODiceDiNo(app, url, 10_000);
  } finally {
    lento.close();
  }
});

test('r1 sulla pagina di un sito che non risponde Condividi copia l\'indirizzo del sito, non quello interno di Filo', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const url = 'http://127.0.0.1:9/irraggiungibile';
  await naviga(app, url);
  await pausa(4000);
  await condividiFaODiceDiNo(app, url);
});

test('r1 sulla home di Filo Condividi non mette negli appunti un indirizzo interno', async ({ app }) => {
  await pausa(1500);
  await condividiFaODiceDiNo(app, null);
});
