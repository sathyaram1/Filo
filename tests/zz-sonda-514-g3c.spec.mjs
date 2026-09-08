// Sonda avversariale #514 (giro 2, parte c) — usa e getta.
import { test, expect } from './fixtures/electron.mjs';

const CON_IFRAME = '<html><body style="margin:0"><p id="t">fuori</p>'
  + '<iframe id="f" srcdoc="<body style=margin:0><p id=i>dentro</p></body>" style="width:400px;height:200px"></iframe></body></html>';

async function setFs(app, on) {
  await app.evaluate(({ BrowserWindow }, v) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(v);
  }, on);
  await new Promise((r) => setTimeout(r, 800));
}
async function etichetta(scope, sel) {
  await scope.locator(sel).click({ button: 'right' });
  await expect(scope.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  const voce = scope.locator('[data-sn-icon-id="fullscreen"]');
  if (await voce.count() === 0) {
    await scope.locator('.sn-menu-row-overflow').first().click();
    await expect(voce.first()).toBeVisible({ timeout: 8000 });
  }
  return voce.first().getAttribute('aria-label');
}

test('nato a schermo intero, poi spento SENZA aver mai aperto un menu', async ({ app, openTab, testServer }) => {
  await setFs(app, true);
  const page = await testServer.openReady(openTab, CON_IFRAME);
  await new Promise((r) => setTimeout(r, 1200));
  await setFs(app, false);
  await new Promise((r) => setTimeout(r, 1200));
  const sopra = await etichetta(page, '#t');
  console.log('SONDA C — pagina principale dopo lo spegnimento →', sopra);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));
  const dentro = await etichetta(page.frameLocator('#f'), '#i');
  console.log('SONDA C — riquadro incorporato dopo lo spegnimento →', dentro);
  expect(sopra).toMatch(/^schermo intero$/i);
  expect(dentro).toMatch(/^schermo intero$/i);
});

test('mai a schermo intero: il riquadro incorporato parte pulito', async ({ openTab, testServer, page: _p }) => {
  const page = await testServer.openReady(openTab, CON_IFRAME);
  await new Promise((r) => setTimeout(r, 800));
  const dentro = await etichetta(page.frameLocator('#f'), '#i');
  console.log('SONDA C — riquadro, mai acceso →', dentro);
  expect(dentro).toMatch(/^schermo intero$/i);
});
