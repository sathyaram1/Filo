// #514 (giro 10) — la porta rimasta: lo schermo pieno che si è preso il SITO.
//
// Nove giri hanno chiuso lo stesso danno (a schermo intero l'Esc porta via la
// modalità invece di chiudere prima il riquadro aperto sopra la pagina) da
// porte sempre nuove, ma sempre sulla modalità di FILO. Qui si prova l'altra
// metà, che è anche quella che l'utente incontra più spesso: il pulsante
// «schermo intero» del lettore video di un sito. Sopra quella pagina Filo apre
// gli stessi riquadri (il menu del tasto destro, il QR, il box di
// segnalazione), e lì l'Esc deve valere uguale.

import { test, expect } from './fixtures/electron.mjs';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen, pageFs: !!t.pageFullscreen };
  });
}
const schermoIntero = async (app) => (await stato(app)).cf;

async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}

async function esc(app, attesa = 1200) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
}

// Un finto lettore video: il pulsante chiede lo schermo pieno, come fa
// YouTube. È il gesto vero (un clic), quindi il permesso c'è.
const LETTORE = `<!doctype html><html><body style="margin:0;height:1200px">
<h1 id="t">un sito con un video</h1>
<button id="fs" style="font-size:20px">schermo intero</button>
<script>
  document.getElementById('fs').addEventListener('click', function () {
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  });
</script>
</body></html>`;

const menuAperto = (page) => page.evaluate(() => !!document.querySelector('.sn-menu'));

// ── 1. Il menu del tasto destro sopra lo schermo pieno del sito ──────────────
test('sito a schermo pieno col suo pulsante: il menu del tasto destro si chiude col primo Esc e la modalità resta', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  // Controprova, fuori dallo schermo intero: l'Esc chiude solo il menu.
  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(page), { timeout: 8000 }).toBe(true);
  await esc(app);
  expect(await menuAperto(page), 'fuori dallo schermo intero l\'Esc chiude il menu').toBe(false);

  // Il sito si prende lo schermo pieno col suo pulsante.
  await page.locator('#fs').click();
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(true);
  expect((await stato(app)).pageFs, 'lo schermo pieno è della pagina').toBe(true);

  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(page), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  expect(await menuAperto(page), 'il primo Esc doveva chiudere il menu').toBe(false);
  expect(
    await schermoIntero(app),
    'il primo Esc ha chiuso il menu E ha spento lo schermo pieno del sito',
  ).toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// ── 2. Lo stesso menu, ma sulla modalità di Filo: la controprova ─────────────
test('controprova: sulla modalità di Filo lo stesso menu si chiude e la modalità resta', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await entra(app);
  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(page), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 400));
  await esc(app);
  expect(await menuAperto(page), 'il primo Esc doveva chiudere il menu').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere la modalità').toBe(true);
});

// ── 3. Il box «Invia feedback» sopra lo schermo pieno del sito ───────────────
test('sito a schermo pieno col suo pulsante: il box di segnalazione si chiude col primo Esc e la modalità resta', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.locator('#fs').click();
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(true);

  await page.evaluate(() => { window.SN_FEEDBACK?.open?.(); });
  const box = page.locator('.sn-fb-modal, .sn-fb-root');
  await expect(box.first()).toBeVisible({ timeout: 8000 });
  await new Promise((r) => setTimeout(r, 400));

  await esc(app);
  expect(await box.count(), 'il primo Esc doveva chiudere il box di segnalazione').toBe(0);
  expect(
    await schermoIntero(app),
    'il primo Esc ha chiuso il box E ha spento lo schermo pieno del sito',
  ).toBe(true);
});
