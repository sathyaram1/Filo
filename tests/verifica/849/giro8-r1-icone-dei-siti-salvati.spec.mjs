// #849 giro 8: «Aperti per dopo» chiede l'icona di ogni pagina salvata al sito che la ospita, un contatto che l'elenco
// dei servizi esterni non dichiara (la sentinella non vede le immagini con l'indirizzo preso dai dati).
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/serviziEsterni.js');
const SE = globalThis.SN_SERVIZI_ESTERNI;

const ICONA = 'https://icona-salvata.example/favicon.ico';

test('r1 aprire «Aperti per dopo» contatta il sito di ogni pagina salvata, e l\'elenco lo dichiara', async ({ app, openTab, testServer }) => {
  const url = testServer.html(
    `<!doctype html><html><head><title>Pagina con icona</title><link rel="icon" href="${ICONA}"></head>
     <body style="padding:40px"><h1>Da leggere dopo</h1></body></html>`,
  );
  const page = await openTab(url);
  await page.waitForLoadState('domcontentloaded');
  await page.click('body', { button: 'right' });
  const btn = page.locator('.sn-menu [data-sn-icon-id="saveForLater"]');
  await expect(btn).toBeVisible();
  await btn.click();
  await page.waitForTimeout(1500).catch(() => {});

  const home = await openTab('filo://home/home.html');
  await expect(home.locator('#grid .sn-card-title', { hasText: 'Pagina con icona' })).toBeVisible();
  // Le richieste si contano dalla sessione della scheda: Playwright non vede quelle fatte da una pagina filo://.
  await app.evaluate(({ webContents }) => {
    globalThis.__chieste849 = [];
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('filo://home/'));
    const segna = (d) => globalThis.__chieste849.push(d.url);
    wc.session.webRequest.onSendHeaders(segna);
    wc.session.webRequest.onErrorOccurred(segna);
  });
  await home.reload();
  await expect(home.locator('#grid .sn-card-title', { hasText: 'Pagina con icona' })).toBeVisible();
  await expect.poll(() => app.evaluate(() => globalThis.__chieste849.filter((u) => u.startsWith('https://icona-salvata.example/')).length))
    .toBeGreaterThan(0);

  const dichiarato = SE.SERVIZI.some((v) => v.dove.includes('src/pages/home/home.js'));
  expect(dichiarato, 'il contatto parte da «Aperti per dopo» ma nessuna voce dell\'elenco nomina quella pagina').toBe(true);
});

// Stessa causa, altre porte: l'archivio delle schede mostra l'icona di ogni sito archiviato chiedendola al sito, e con il
// login Google la barra e la home mostrano la foto del profilo chiesta ai server di Google a ogni avvio.
test('r1 le altre pagine che caricano un\'immagine da un indirizzo preso dai dati sono nell\'elenco', () => {
  for (const f of ['src/pages/archive/archive.js', 'src/renderer/barra.js', 'src/renderer/shell.js']) {
    expect(SE.SERVIZI.some((v) => v.dove.includes(f)), f).toBe(true);
  }
});
