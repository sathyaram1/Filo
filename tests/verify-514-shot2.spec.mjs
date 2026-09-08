// Traccia visiva per la verifica #514 (screenshot in tests/.shots/).
import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '.shots');

test('traccia — pagina a schermo intero e ritorno', async ({ app, testServer, openTab }) => {
  mkdirSync(SHOTS, { recursive: true });
  const page = await testServer.openReady(
    openTab,
    '<html><body style="margin:0;font:16px system-ui;background:#f5efe6">'
    + '<div style="padding:24px">Pagina di prova</div></body></html>',
  );
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${SHOTS}/514-fullscreen.png` });
  await app.evaluate(async ({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: `${SHOTS}/514-dopo-esc.png` });
  expect(true).toBe(true);
});

test('traccia — visore a schermo intero della pagina di gestione', async ({ openTab }) => {
  mkdirSync(SHOTS, { recursive: true });
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    document.getElementById('mgLightboxImg').src =
      'data:image/svg+xml;base64,'
      + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="280">'
        + '<rect width="420" height="280" fill="#c9a227"/>'
        + '<text x="30" y="150" font-size="28" fill="#111">immagine allegata</text></svg>');
    document.getElementById('mgLightbox').classList.add('open');
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `${SHOTS}/514-manage-visore.png` });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${SHOTS}/514-manage-visore-dopo-esc.png` });
  expect(true).toBe(true);
});
