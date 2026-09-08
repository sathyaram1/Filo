// Diagnostica giro 10 — che succede a un Esc premuto mentre è il SITO ad avere
// lo schermo pieno (il pulsante del lettore video) e sopra c'è un riquadro di
// Filo. Non asserisce: registra la traccia.

import { test, expect } from './fixtures/electron.mjs';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen, pageFs: !!t.pageFullscreen };
  });
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

const LETTORE = `<!doctype html><html><body style="margin:0;height:1200px">
<h1 id="t">un sito con un video</h1>
<button id="fs" style="font-size:20px">schermo intero</button>
<script>
  window.__tasti = [];
  window.addEventListener('keydown', function (e) { window.__tasti.push(e.key); }, true);
  document.getElementById('fs').addEventListener('click', function () {
    try { document.documentElement.requestFullscreen(); } catch (_) {}
  });
</script>
</body></html>`;

const menuAperto = (page) => page.evaluate(() => !!document.querySelector('.sn-menu'));

async function vaiAPienoDelSito(app, page) {
  await page.locator('#fs').click();
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(true);
}

// ── QR code aperto sopra lo schermo pieno del sito ───────────────────────────
test('diagnostica: schermo pieno del sito + QR + Esc', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await vaiAPienoDelSito(app, page);

  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(page), { timeout: 8000 }).toBe(true);
  const voce = page.locator('[data-sn-icon-id="qrCode"]');
  if (await voce.count() === 0) await page.locator('.sn-menu-row-overflow').first().click();
  await voce.first().click();
  await new Promise((r) => setTimeout(r, 1200));
  const qrAperto = () => page.evaluate(() => !!document.querySelector('.sn-popup, .sn-qr, [class*="qr"]'));
  console.log('QR-APERTO-PRIMA', await qrAperto(), 'MENU', await menuAperto(page));

  await esc(app);
  console.log('DOPO-ESC-1', JSON.stringify({
    qr: await qrAperto(), menu: await menuAperto(page), ...(await stato(app)),
    tasti: await page.evaluate(() => window.__tasti.slice()),
  }));
});

// ── Il menu che resta aperto dopo il primo Esc: che nome porta la voce? ──────
test('diagnostica: il menu rimasto aperto dopo l\'uscita', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await vaiAPienoDelSito(app, page);

  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(page), { timeout: 8000 }).toBe(true);
  const voce = page.locator('[data-sn-icon-id="fullscreen"]');
  if (await voce.count() === 0) await page.locator('.sn-menu-row-overflow').first().click();
  await expect(voce.first()).toBeVisible({ timeout: 8000 });
  console.log('ETICHETTA-PRIMA', await voce.first().getAttribute('aria-label'), '|', (await voce.first().innerText()).slice(0, 60));

  await esc(app);
  console.log('DOPO-ESC', JSON.stringify({ menu: await menuAperto(page), ...(await stato(app)) }));
  if (await voce.count() > 0) {
    console.log('ETICHETTA-DOPO', await voce.first().getAttribute('aria-label'), '|', (await voce.first().innerText()).slice(0, 60));
  }
});

// ── E se il sito è a schermo pieno ma nessun riquadro è aperto? ──────────────
test('diagnostica: schermo pieno del sito senza riquadri — un Esc basta', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, LETTORE);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await vaiAPienoDelSito(app, page);
  await esc(app);
  console.log('SENZA-RIQUADRI', JSON.stringify(await stato(app)));
});
