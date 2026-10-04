// #946 giro 1: aperture in fretta su due immagini diverse e la riga nei due temi.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pngSpoglio } from '../../helpers/immagineFirmata.mjs';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'provenienza');

test('aprire il menu su una firmata e subito dopo su una spoglia: la spoglia resta muta', async ({ openTab, testServer }) => {
  const firmata = testServer.asset(readFileSync(join(FIXTURE, 'c2pa-ufficiale-ai.jpg')), 'image/jpeg').replace('127.0.0.1', 'localhost');
  const spoglia = testServer.asset(pngSpoglio(), 'image/png');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <img id="a" src="${firmata}" width="160" height="160">
    <img id="b" src="${spoglia}" width="160" height="160"></body></html>`);
  await page.waitForFunction(() => document.getElementById('a').naturalWidth > 0);
  const menu = page.locator('.sn-menu');
  for (let i = 0; i < 3; i++) {
    await page.locator('#a').click({ button: 'right', position: { x: 20, y: 20 } });
    await page.keyboard.press('Escape');
  }
  await page.locator('#b').click({ button: 'right', position: { x: 20, y: 20 } });
  await expect(menu.locator('.sn-menu-link-body')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2500);
  await expect(menu.locator('.sn-menu-origine')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.locator('#a').click({ button: 'right', position: { x: 20, y: 20 } });
  await expect(menu.locator('.sn-menu-origine')).toContainText('Generata con l’AI', { timeout: 10000 });
});

test('la riga nei due temi', async ({ app, openTab, testServer }) => {
  const src = testServer.asset(readFileSync(join(FIXTURE, 'c2pa-ufficiale-ai.jpg')), 'image/jpeg');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <img id="foto" src="${src}" width="160" height="160"></body></html>`);
  for (const tema of ['light', 'dark']) {
    await app.evaluate((_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
    await page.waitForTimeout(500);
    await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    const menu = page.locator('.sn-menu');
    await expect(menu.locator('.sn-menu-origine')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `tests/.shots/verifica-946-${tema}.png` });
    await page.keyboard.press('Escape');
  }
});
