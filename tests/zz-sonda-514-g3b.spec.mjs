// Sonda avversariale #514 (giro 2, parte b) — usa e getta.
import { test, expect } from './fixtures/electron.mjs';

const PAGINA = '<html><body style="margin:0"><p id="t">ciao</p></body></html>';
const CON_IFRAME = '<html><body style="margin:0"><p id="t">fuori</p>'
  + '<iframe id="f" srcdoc="<body style=margin:0><p id=i>dentro</p></body>" style="width:400px;height:200px"></iframe></body></html>';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen };
  });
}
async function setFs(app, on) {
  await app.evaluate(({ BrowserWindow }, v) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(v);
  }, on);
  await new Promise((r) => setTimeout(r, 600));
}
async function apriMenu(scope, sel) {
  await scope.locator(sel).click({ button: 'right' });
  await expect(scope.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
}
async function vociFullscreen(scope) {
  const voce = scope.locator('[data-sn-icon-id="fullscreen"]');
  if (await voce.count() === 0) {
    await scope.locator('.sn-menu-row-overflow').first().click();
    await expect(voce.first()).toBeVisible({ timeout: 8000 });
  }
  return voce.first();
}

test('IFRAME nato a schermo intero: etichetta accesa, e dopo lo spegnimento torna a dire il vero', async ({ app, openTab, testServer }) => {
  await setFs(app, true);
  const page = await testServer.openReady(openTab, CON_IFRAME);
  await new Promise((r) => setTimeout(r, 1000));
  const dentro = page.frameLocator('#f');
  await apriMenu(dentro, '#i');
  const acceso = await (await vociFullscreen(dentro)).getAttribute('aria-label');
  console.log('SONDA iframe nato a schermo intero →', acceso);
  // chiudo il menu con un clic (non con Esc: a schermo intero l'Esc è del main)
  await dentro.locator('#i').click({ position: { x: 5, y: 5 } });
  await setFs(app, false);
  await new Promise((r) => setTimeout(r, 800));
  await apriMenu(dentro, '#i');
  const spento = await (await vociFullscreen(dentro)).getAttribute('aria-label');
  console.log('SONDA iframe dopo lo spegnimento →', spento);
  expect(spento).toMatch(/^schermo intero$/i);
});

test('la voce dentro il riquadro incorporato ESCE davvero dallo schermo intero', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, CON_IFRAME);
  await setFs(app, true);
  await new Promise((r) => setTimeout(r, 600));
  const dentro = page.frameLocator('#f');
  await apriMenu(dentro, '#i');
  const b = await vociFullscreen(dentro);
  console.log('SONDA etichetta nel riquadro (annuncio) →', await b.getAttribute('aria-label'));
  await b.click();
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
});

test('menu del tasto destro aperto: Esc lo chiude fuori dallo schermo intero, e dentro?', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  // baseline: fuori dallo schermo intero
  await apriMenu(page, '#t');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));
  const fuori = await page.locator('.sn-menu').first().isVisible().catch(() => false);
  console.log('SONDA menu dopo Esc, schermo intero SPENTO → visibile:', fuori);

  await setFs(app, true);
  await apriMenu(page, '#t');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 700));
  const dentro = await page.locator('.sn-menu').first().isVisible().catch(() => false);
  const fs = (await stato(app)).cf;
  console.log('SONDA menu dopo Esc, schermo intero ACCESO → visibile:', dentro, ' fullscreen ancora:', fs);
  await setFs(app, false);
});
