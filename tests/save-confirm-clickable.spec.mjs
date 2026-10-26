// #252 — la conferma di «Salva per dopo» (premuto nella barra laterale) è CLICCABILE e apre la lista «Aperti per
// dopo» con la scheda appena salvata evidenziata: prima era un toast muto, e chi salvava non sapeva dove cercarla.

import { test, expect } from './fixtures/electron.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';

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

  await premiNellaBarra(app, 'saveForLater');

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
