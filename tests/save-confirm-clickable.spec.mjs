// #252 — Dopo "Salva per dopo" la conferma deve essere CLICCABILE e portare alla
// lista "Aperti per dopo", con la scheda appena salvata evidenziata.
//
// Prima: "Salva per dopo" mostrava un toast muto e chiudeva la scheda quasi
// subito; chi salvava la prima volta non scopriva mai dove fosse finita la
// pagina. Ora la conferma è un riquadro cliccabile che apre la lista con la
// scheda evidenziata.
//
// Assert di SUCCESSO (rosso senza il fix):
//   1. dopo il salvataggio compare un riquadro di conferma CLICCABILE con la
//      call-to-action per aprire la lista (senza il fix è un toast non cliccabile);
//   2. cliccandolo si apre davvero "Aperti per dopo" con ?highlight=<id> nell'URL;
//   3. nella lista la scheda salvata è quella evidenziata (data-highlighted).

import { test, expect } from './fixtures/electron.mjs';

test('la conferma di "Salva per dopo" è cliccabile e apre la lista con la scheda evidenziata', async ({ app, openTab, testServer }) => {
  const pageUrl = testServer.html(
    `<!doctype html><html><head><title>Articolo da rileggere</title></head>
     <body style="margin:0;height:100vh;background:#fff"><h1>Contenuto</h1></body></html>`,
  );

  const page = await openTab(pageUrl);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null,
    { timeout: 8000 },
  );

  // Apri il menu tasto destro e clicca "Salva per dopo".
  await page.click('body', { button: 'right', position: { x: 400, y: 300 } });
  const btn = page.locator('.sn-menu [data-sn-icon-id="saveForLater"]');
  await expect(btn).toBeVisible();
  await btn.click();

  // 1) Compare la conferma CLICCABILE con la call-to-action.
  const pill = page.locator('.sn-save-confirm');
  await expect(pill).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sn-save-confirm-cta')).toHaveCount(1);
  try { await page.screenshot({ path: 'tests/.shots/save-confirm-252.png' }); } catch (_) {}

  // 2) Clic sulla conferma → si apre "Aperti per dopo" con ?highlight=<id>.
  await pill.click();

  const deadline = Date.now() + 8000;
  let home = null;
  while (Date.now() < deadline) {
    home = app.windows().find((w) => {
      try { return w.url().startsWith('filo://home/home.html'); } catch (_) { return false; }
    });
    if (home) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(home, 'cliccando la conferma non si è aperta la lista "Aperti per dopo"').toBeTruthy();
  expect(home.url(), 'manca ?highlight=<id> nell\'URL della lista').toMatch(/[?&]highlight=[^&]+/);

  await home.waitForLoadState('domcontentloaded');

  // La lista filo:// ha la chrome shim: leggiamo l'id della scheda salvata.
  const savedId = await home.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_SAVED_PAGES });
    return ((r && r.pages) || [])[0]?.id || null;
  });
  expect(savedId, 'la pagina non risulta salvata').toBeTruthy();
  expect(home.url(), 'l\'URL della lista deve puntare alla scheda salvata').toContain(`highlight=${savedId}`);

  // 3) La scheda evidenziata è proprio quella salvata.
  const highlighted = home.locator('.sn-card[data-highlighted="1"]');
  await expect(highlighted).toHaveCount(1, { timeout: 8000 });
  await expect(highlighted).toHaveAttribute('data-page-id', savedId);
});
