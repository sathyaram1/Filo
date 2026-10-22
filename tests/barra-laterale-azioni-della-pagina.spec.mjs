// #1343 — le azioni sulla pagina della barra laterale fanno quello che dicono anche dove la pagina non dà una mano: il
// visore PDF (che lascia in sospeso gli appunti della pagina) e la pagina che sta ancora arrivando (Filo non c'è ancora).

import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { iconaDellaBarra } from './helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = '<!doctype html><html><head><title>Prima</title></head><body><h1>Prima</h1></body></html>';
const naviga = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.navigate(w._filoTabs.activeId, url);
}, u);
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());

test('su un PDF Condividi della barra copia l\'indirizzo del documento', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const url = testServer.asset(readFileSync('tests/fixtures/documenti/documento-con-testo.pdf'), 'application/pdf');
  await naviga(app, url);
  await pausa(2500);
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  const share = await iconaDellaBarra(app, 'share');
  expect(await share.getAttribute('aria-disabled')).not.toBe('true');
  await share.click();
  await expect.poll(() => appunti(app), { timeout: 5000, message: 'l\'indirizzo del PDF arriva negli appunti' }).toBe(url);
});

test('su un PDF Screenshot della barra salva la foto della pagina', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  await naviga(app, testServer.asset(readFileSync('tests/fixtures/documenti/documento-con-testo.pdf'), 'application/pdf'));
  await pausa(2500);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    globalThis.__fotoSalvate = [];
    t.view.webContents.session.on('will-download', (e, item) => { globalThis.__fotoSalvate.push(item.getFilename()); e.preventDefault(); });
  });
  await (await iconaDellaBarra(app, 'screenshot')).click();
  await expect.poll(() => app.evaluate(() => globalThis.__fotoSalvate.length), { timeout: 15_000, message: 'la foto parte anche se gli appunti del PDF restano sospesi' }).toBeGreaterThan(0);
});

test('su una pagina che sta ancora arrivando Condividi della barra aspetta la pagina e copia il suo indirizzo', async ({ app, openTab, testServer }) => {
  const lento = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write('<!doctype html><title>Lenta</title><h1>Arriva…</h1>' + ' '.repeat(4096));
    setTimeout(() => res.end('<p>finita</p>'), 4000);
  });
  await new Promise((r) => lento.listen(0, '127.0.0.1', r));
  try {
    await testServer.openReady(openTab, SITO);
    const url = `http://127.0.0.1:${lento.address().port}/lenta`;
    await naviga(app, url);
    await pausa(1500);
    await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
    const share = await iconaDellaBarra(app, 'share');
    expect(await share.getAttribute('aria-disabled'), 'mentre arriva la pagina l\'azione resta premibile').not.toBe('true');
    await share.click();
    await expect.poll(() => appunti(app), { timeout: 10_000, message: 'appena la pagina c\'è, l\'indirizzo arriva negli appunti' }).toBe(url);
  } finally {
    lento.close();
  }
});

test('dove Filo non è nella pagina le azioni sulla pagina si mostrano spente e dicono perché', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  // La pagina non riferisce più niente a Filo (come un documento dove i suoi pezzi non entrano) e non sta caricando.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.aiuto = null;
    t.loading = false;
    w._filoTabs.barra.aggiornaNav();
  });
  const share = await iconaDellaBarra(app, 'share');
  await expect(share).toHaveAttribute('aria-disabled', 'true');
  expect(await share.getAttribute('data-sugg')).toContain('Filo non può agire');
});
