// #849 giro 8: «Aperti per dopo» chiede l'icona di ogni pagina salvata al sito che la ospita, un contatto che l'elenco
// dei servizi esterni non dichiara (la sentinella non vede le immagini con l'indirizzo preso dai dati).
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/serviziEsterni.js');
const SE = globalThis.SN_SERVIZI_ESTERNI;

const ICONA = 'https://icona-salvata.example/favicon.ico';

test('r1 aprire «Aperti per dopo» contatta il sito di ogni pagina salvata, e l\'elenco lo dichiara', async ({ openTab, testServer }) => {
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
  const chieste = [];
  home.on('request', (r) => chieste.push(r.url()));
  await home.reload();
  await expect(home.locator('#grid .sn-card-title', { hasText: 'Pagina con icona' })).toBeVisible();
  await expect.poll(() => chieste.filter((u) => u.startsWith('https://icona-salvata.example/')).length).toBeGreaterThan(0);

  const dichiarato = SE.SERVIZI.some((v) => v.dove.includes('src/pages/home/home.js'));
  expect(dichiarato, 'il contatto parte da «Aperti per dopo» ma nessuna voce dell\'elenco nomina quella pagina').toBe(true);
});
