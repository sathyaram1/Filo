// #946 giro 2: esplorazione visiva della riga (forte e debole) nei due temi.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pngSpoglio, pngConTesto } from '../../helpers/immagineFirmata.mjs';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'provenienza');

test('la riga nei due temi, forte e debole', async ({ app, openTab, testServer }) => {
  const forte = testServer.asset(readFileSync(join(FIXTURE, 'c2pa-ufficiale-ai.jpg')), 'image/jpeg');
  const debole = testServer.asset(pngConTesto(pngSpoglio(64), 'parameters', 'un gatto astronauta\nSteps: 30'), 'image/png');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <img id="a" src="${forte}" width="300" height="300">
    <img id="b" src="${debole}" width="300" height="300"></body></html>`);
  for (const tema of ['light', 'dark']) {
    await app.evaluate((_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
    await page.waitForTimeout(500);
    for (const id of ['a', 'b']) {
      await page.locator('#' + id).click({ button: 'right', position: { x: 40, y: 40 } });
      const menu = page.locator('.sn-menu');
      await expect(menu.locator('.sn-menu-origine')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `tests/.shots/verifica-946-g2-${tema}-${id}.png` });
      await page.keyboard.press('Escape');
    }
  }
});
