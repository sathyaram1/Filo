// Sonda visiva #514 (giro 2) — usa e getta. Tracce in tests/.shots/.
import { test } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const PAGINA = '<html><body style="margin:0;background:#f6efe6;font:16px system-ui">'
  + '<h1 id="t" style="padding:24px">Una pagina qualunque</h1></body></html>';

async function setFs(app, on) {
  await app.evaluate(({ BrowserWindow }, v) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(v);
  }, on);
  await new Promise((r) => setTimeout(r, 900));
}

test('tracce visive: schermo intero acceso, menu, e ritorno dopo Esc', async ({ app, shell, openTab, testServer }) => {
  mkdirSync('tests/.shots', { recursive: true });
  const page = await testServer.openReady(openTab, PAGINA);
  await shell.screenshot({ path: 'tests/.shots/514-g2-01-normale.png' });

  await setFs(app, true);
  await shell.screenshot({ path: 'tests/.shots/514-g2-02-schermo-intero.png' });

  await page.locator('#t').click({ button: 'right' });
  await page.waitForSelector('.sn-menu', { timeout: 8000 });
  const voce = page.locator('[data-sn-icon-id="fullscreen"]');
  if (await voce.count() === 0) await page.locator('.sn-menu-row-overflow').first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/514-g2-03-menu-dentro.png' });

  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await page.waitForTimeout(1200);
  await shell.screenshot({ path: 'tests/.shots/514-g2-04-dopo-esc.png' });
  await page.screenshot({ path: 'tests/.shots/514-g2-05-dopo-esc-pagina.png' });
});

test('traccia visiva: il visore dell\'immagine nella pagina di gestione', async ({ openTab }) => {
  mkdirSync('tests/.shots', { recursive: true });
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    document.getElementById('mgLightboxImg').src =
      'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#c96"/><text x="20" y="110" font-size="28">allegato</text></svg>');
    document.getElementById('mgLightbox').classList.add('open');
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/514-g2-06-visore-aperto.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/514-g2-07-visore-chiuso.png' });
});
