// Verifica #725.1 giro 1: l'avviso del link sospetto quando si clicca l'immagine
// che lo apre, nelle forme che il lavoro non ha provato (immagine rotta, altri
// avvisi, riquadro incorporato, tastiera, tema scuro, mappa d'immagine).

import { test, expect } from '../../fixtures/electron.mjs';

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const pagina = (corpo) => `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">${corpo}</body></html>`;

async function avvisoNelMenu(page) {
  const sezione = page.locator('.sn-menu .sn-menu-inline[data-subject="image"]');
  await expect(sezione).toBeVisible();
  const avviso = sezione.locator('.sn-menu-link-warn');
  await expect(avviso).toBeVisible({ timeout: 3000 });
  return ((await avviso.textContent()) || '').trim();
}

test('immagine rotta dentro un link sospetto: l\'avviso resta dopo l\'errore', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina(
    `<a href="https://paypa1.com/login"><img id="clic" src="/non-esiste.png" width="240" height="140" style="background:#e07b39"></a>`));
  await page.locator('#clic').click({ button: 'right', position: { x: 20, y: 20 } });
  expect(await avvisoNelMenu(page)).toContain('paypal.com');
  await page.waitForTimeout(2000);
  await expect(page.locator('.sn-menu .sn-menu-link-warn')).toBeVisible();
});

test('gli altri avvisi (azione, credenziale) arrivano anche dall\'immagine', async ({ openTab, testServer }) => {
  for (const href of ['https://esempio.test/account/logout', 'https://esempio.test/x?token=abcdef0123456789abcdef']) {
    const page = await testServer.openReady(openTab, pagina(
      `<a href="${href}"><img id="clic" src="${PX}" width="240" height="140" style="background:#e07b39"></a>`));
    await page.locator('#clic').click({ button: 'right', position: { x: 20, y: 20 } });
    const testo = await avvisoNelMenu(page);
    expect(testo.length).toBeGreaterThan(10);
    await page.close();
  }
});

test('con la tastiera (Maiusc+F10 sul link a fuoco) l\'avviso c\'è', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina(
    `<a id="lnk" href="https://paypa1.com/login"><img src="${PX}" width="240" height="140" style="background:#e07b39"></a>`));
  await page.locator('#lnk').focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-link-warn')).toBeVisible({ timeout: 3000 });
  expect(await menu.locator('.sn-menu-link-warn').textContent()).toContain('paypal.com');
});

test('dentro un riquadro incorporato (come il corpo di una mail) l\'avviso c\'è', async ({ openTab, testServer }) => {
  const dentro = testServer.html(pagina(
    `<a href="https://paypa1.com/login"><img id="clic" src="${PX}" width="240" height="140" style="background:#e07b39"></a>`));
  const page = await testServer.openReady(openTab, pagina(`<iframe id="f" src="${dentro}" width="400" height="260"></iframe>`));
  const frame = page.frameLocator('#f');
  await expect(frame.locator('#clic')).toBeVisible();
  await page.waitForTimeout(800);
  await frame.locator('#clic').click({ button: 'right', position: { x: 20, y: 20 } });
  const warn = frame.locator('.sn-menu .sn-menu-inline[data-subject="image"] .sn-menu-link-warn');
  await expect(warn).toBeVisible({ timeout: 4000 });
  expect(await warn.textContent()).toContain('paypal.com');
});

test('tema scuro: l\'avviso nella sezione dell\'immagine si legge', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina(
    `<a href="https://paypa1.com/login"><img id="clic" src="${PX}" width="240" height="140" style="background:#e07b39"></a>`));
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.locator('#clic').click({ button: 'right', position: { x: 20, y: 20 } });
  await avvisoNelMenu(page);
  await page.screenshot({ path: 'tests/.shots/725-1-verifica-scuro.png' });
});
