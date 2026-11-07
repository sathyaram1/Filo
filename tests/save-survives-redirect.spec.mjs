// #334 — «Salva per dopo» non si perde in silenzio se la pagina cambia (redirect, ricarica) subito dopo il clic:
// il salvataggio parte al clic, prima di attendere la miniatura, che è best-effort. Il clic è nella barra laterale.

import { test, expect } from './fixtures/electron.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';

test('Salva per dopo resiste al redirect immediato dopo il click', async ({ app, openTab, testServer }) => {
  const urlA = testServer.html(
    `<!doctype html><html><head><title>Pagina da salvare</title></head>
     <body style="margin:0;height:100vh;background:#fff"></body></html>`,
  );
  const urlB = testServer.html(
    `<!doctype html><html><head><title>Destinazione redirect</title></head>
     <body style="margin:0;height:100vh;background:#eee"></body></html>`,
  );

  const page = await openTab(urlA);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null,
    { timeout: 8000 },
  );

  await premiNellaBarra(app, 'saveForLater');

  // Redirect IMMEDIATO: simula un sito che si ricarica / reindirizza nel decimo
  // di secondo subito dopo il click, dentro la finestra della cattura miniatura.
  await page.goto(urlB).catch(() => {});

  // Lascia concludere il salvataggio lato main.
  await page.waitForTimeout(1500).catch(() => {});

  // Verifica che la scheda sia davvero in "Aperti per dopo" con l'URL originale.
  const home = await openTab('filo://home/home.html');
  await home.waitForLoadState('domcontentloaded');
  const saved = await home.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_SAVED_PAGES });
    return (r && r.pages) || [];
  });

  const match = saved.find((p) => p.url === urlA);
  expect(match, `nessuna scheda salvata per l'URL originale (salvate: ${saved.length})`).toBeTruthy();
  expect(match.title).toBe('Pagina da salvare');
});
