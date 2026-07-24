// "Salva per dopo" dal menu del tasto destro NON deve perdersi in silenzio se
// la pagina cambia (redirect / reload) subito dopo il click (#334).
//
// Prima del fix: savePage attendeva ~120ms la cattura della miniatura PRIMA di
// inviare il messaggio di salvataggio. Se in quella finestra la pagina navigava,
// il contesto del content script veniva distrutto e SAVE_PAGE non partiva mai:
// nessuna scheda in "Aperti per dopo", nessun avviso.
//
// Assert di SUCCESSO (non assenza d'errore): dopo aver cliccato "Salva per dopo"
// e aver fatto navigare via la pagina immediatamente, la scheda DEVE comparire
// in "Aperti per dopo" con l'URL originale. Senza il fix questo test è rosso
// (nessuna pagina salvata); col fix è verde (il salvataggio parte al click,
// prima di ogni attesa, e la miniatura è best-effort).

import { test, expect } from './fixtures/electron.mjs';

test('Salva per dopo resiste al redirect immediato dopo il click', async ({ openTab, testServer }) => {
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

  // Apre il menu tasto destro e clicca l'icona "Salva per dopo".
  await page.click('body', { button: 'right', position: { x: 400, y: 300 } });
  const btn = page.locator('.sn-menu [data-sn-icon-id="saveForLater"]');
  await expect(btn).toBeVisible();
  await btn.click();

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
