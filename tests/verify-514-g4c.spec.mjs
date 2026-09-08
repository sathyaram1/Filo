// #514 giro 4 — le porte sui SITI: riquadri di Filo che si chiudono con Esc ma
// che il main non conosce (QR code della pagina).

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = '<html><body style="margin:0;height:1200px"><p id="t">parola dentro una frase</p></body></html>';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen, conRiquadro: [...t.tabsWithFiloBox], attiva: t.activeId };
  });
}

async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}

async function esc(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 900));
}

async function voceMenu(page, id) {
  const voce = page.locator(`[data-sn-icon-id="${id}"]`);
  if (await voce.count() === 0) {
    const overflow = page.locator('.sn-menu-row-overflow').first();
    if (await overflow.count() > 0) await overflow.click();
  }
  return voce.first();
}

test('QR code aperto a schermo intero: il primo Esc chiude lui', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await entra(app);
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  const qr = await voceMenu(page, 'qrCode');
  await expect(qr).toBeVisible({ timeout: 8000 });
  await qr.click();
  await expect(page.locator('.sn-qr-overlay')).toBeVisible({ timeout: 8000 });
  await new Promise((r) => setTimeout(r, 500));
  console.log('[qr] setup:', JSON.stringify(await stato(app)));

  await esc(app);
  const dopo = await stato(app);
  const ancora = await page.locator('.sn-qr-overlay').count();
  console.log('[qr] overlay ancora aperto:', ancora, '| schermo intero:', dopo.cf);
  expect({ overlayAperto: ancora > 0, schermoIntero: dopo.cf })
    .toEqual({ overlayAperto: false, schermoIntero: true });
});

test('fuori dallo schermo intero il QR si chiude con Esc (controprova)', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  const qr = await voceMenu(page, 'qrCode');
  await qr.click();
  await expect(page.locator('.sn-qr-overlay')).toBeVisible({ timeout: 8000 });
  await new Promise((r) => setTimeout(r, 400));
  await esc(app);
  const ancora = await page.locator('.sn-qr-overlay').count();
  console.log('[qr controprova] overlay ancora aperto:', ancora);
  expect(ancora).toBe(0);
});

test('cattura di una parte dello schermo: a schermo intero il primo Esc deve annullare la selezione', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await entra(app);
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  const crop = await voceMenu(page, 'screenshotCrop');
  await expect(crop).toBeVisible({ timeout: 8000 });
  await crop.click();
  await expect(page.locator('.sn-region-overlay')).toBeVisible({ timeout: 8000 });
  await new Promise((r) => setTimeout(r, 500));
  console.log('[crop] setup:', JSON.stringify(await stato(app)));

  await esc(app);
  const dopo = await stato(app);
  const ancora = await page.locator('.sn-region-overlay').count();
  console.log('[crop] selezione ancora attiva:', ancora, '| schermo intero:', dopo.cf);
  expect({ selezioneAttiva: ancora > 0, schermoIntero: dopo.cf })
    .toEqual({ selezioneAttiva: false, schermoIntero: true });
});
