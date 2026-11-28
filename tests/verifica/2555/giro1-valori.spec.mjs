// Verifica #2555 giro 1: valori e stati del filmato e della pagina (velocità, dimensione, ripeti).

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
mkdirSync(SHOTS, { recursive: true });
const SITO = `<!doctype html><html><head><title>Film</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <video id="film" width="240" height="135" style="background:#222"></video>
  <div id="vuoto" style="height:300px"></div></body></html>`;

// La voce col nome dato, dovunque stia: nella griglia, dietro il «+» o «Altro…», o scritta.
async function clicVoce(page, menu, nome) {
  const trova = () => menu.valuta((n) => {
    const tutte = [...document.querySelectorAll('.sn-menu .sn-menu-row-btn, .sn-menu .sn-menu-item')];
    const b = tutte.find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().startsWith(n));
    if (!b) return 'manca';
    if (!b.getClientRects().length) return 'nascosta';
    return 'ok';
  }, nome);
  let s = await trova();
  if (s !== 'ok') {
    const piu = menu.locator('.sn-menu-row-overflow').first();
    if (await piu.count()) { await piu.click(); await page.waitForTimeout(300); }
    s = await trova();
  }
  expect(s, `«${nome}» raggiungibile`).toBe('ok');
  await menu.locator('.sn-menu .sn-menu-row-btn, .sn-menu .sn-menu-item').filter({ visible: true })
    .and(menu.locator(`[aria-label^="${nome}"], :text-is("${nome}")`)).first().click().catch(async () => {
      await menu.valuta((n) => {
        const b = [...document.querySelectorAll('.sn-menu .sn-menu-row-btn, .sn-menu .sn-menu-item')]
          .find((x) => x.getClientRects().length && (x.getAttribute('aria-label') || x.textContent || '').trim().startsWith(n));
        b.click();
      }, nome);
    });
}

test('ripeti in continuo dal tasto destro accende la ripetizione del filmato', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const menu = menuDi(page);
  await page.locator('#film').click({ button: 'right' });
  await expect(menu.locator('.sn-menu').first()).toBeVisible();
  await clicVoce(page, menu, 'Ripeti in continuo');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.getElementById('film').loop)).toBe(true);
});

test('il clic sulla dimensione apre i valori, e non rimette la pagina al 100%', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const zoomDi = () => app.evaluate(({ BrowserWindow }, u) => {
    for (const win of BrowserWindow.getAllWindows()) {
      for (const t of win._filoTabs?.tabs || []) { try { if (t.view?.webContents?.getURL() === u) return t.view.webContents.getZoomFactor(); } catch (_) {} }
    }
    return null;
  }, page.url());
  await app.evaluate(({ BrowserWindow }, u) => {
    for (const win of BrowserWindow.getAllWindows()) {
      for (const t of win._filoTabs?.tabs || []) { try { if (t.view?.webContents?.getURL() === u) t.view.webContents.setZoomFactor(1.25); } catch (_) {} }
    }
  }, page.url());
  const menu = menuDi(page);
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(menu.locator('.sn-menu').first()).toBeVisible();
  await menu.locator('.sn-menu-row-overflow').first().click();
  await menu.locator('[data-sn-verbo="zoom"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(SHOTS, 'v2555-zoom-valori.png') });
  expect(await zoomDi(), 'il clic non cambia la dimensione da solo').toBeCloseTo(1.25, 2);
  await expect(menu.locator('.sn-menu-sub .sn-menu-item').first(), 'i valori si aprono').toBeVisible();
});

test('il clic sulla velocità apre i valori', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const menu = menuDi(page);
  await page.locator('#film').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  await menu.locator('[data-sn-verbo="speed"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(SHOTS, 'v2555-velocita-valori.png') });
  await expect(menu.locator('.sn-menu-sub .sn-menu-item').first()).toBeVisible();
});
