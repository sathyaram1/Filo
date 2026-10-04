// #946 giro 2: esplorazione — il sito legge quello che il menu dice di un'immagine di un altro dominio?

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'provenienza');

test('window.find sul testo della riga', async ({ openTab, testServer }) => {
  const src = testServer.asset(readFileSync(join(FIXTURE, 'c2pa-ufficiale-ai.jpg')), 'image/jpeg').replace('127.0.0.1', 'localhost');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <img id="foto" src="${src}" width="200" height="200"></body></html>`);
  await page.waitForFunction(() => document.getElementById('foto').naturalWidth > 0);
  await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
  await expect(page.locator('.sn-menu .sn-menu-origine')).toBeVisible({ timeout: 10000 });
  const r = await page.evaluate(() => ({
    find: window.find('Signing Cert'),
    body: document.body.innerText.includes('Signing'),
    sel: String(window.getSelection()),
  }));
  console.log('ESITO', JSON.stringify(r));
});
