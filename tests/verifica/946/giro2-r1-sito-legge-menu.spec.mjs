// #946 giro 2: quello che Filo dice di un'immagine di un altro dominio (scaricata coi
// cookie dell'utente) non deve essere leggibile dal sito che la mostra.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'provenienza');

test('il sito non ritrova con window.find il testo del riquadro su un’immagine di un altro dominio', async ({ openTab, testServer }) => {
  const src = testServer.asset(readFileSync(join(FIXTURE, 'c2pa-ufficiale-ai.jpg')), 'image/jpeg').replace('127.0.0.1', 'localhost');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <img id="foto" src="${src}" width="200" height="200"></body></html>`);
  await page.waitForFunction(() => document.getElementById('foto').naturalWidth > 0);
  await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
  await expect(page.locator('.sn-menu .sn-menu-origine')).toContainText('Signing Cert', { timeout: 10000 });
  expect(await page.evaluate(() => window.find('Signing Cert'))).toBe(false);
});
