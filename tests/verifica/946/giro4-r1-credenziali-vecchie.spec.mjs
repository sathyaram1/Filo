// #946 giro 4: credenziali valide nel formato del 2022-2023 (catena dei certificati sotto
// l'etichetta testuale «x5chain») non devono essere presentate come «firma non valida».
// Il file viene dalle prove dell'SDK di riferimento del C2PA, che lo legge come valido.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = readFileSync(join(process.cwd(), 'tests', 'verifica', '946', 'giro4-r1-credenziali-formato-2023.jpg'));

test('credenziali valide nel formato del 2023: il menu non dice che la firma non è valida', async ({ app, openTab, testServer }) => {
  const esito = await app.evaluate((_e, b64) => globalThis.__filoFirmatariC2pa.analizzaImmagine(Buffer.from(b64, 'base64')), FILE.toString('base64'));
  expect(esito.prova).not.toBe('firma-rotta');

  const src = testServer.asset(FILE, 'image/jpeg');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <img id="foto" src="${src}" width="200" height="200"></body></html>`);
  await page.waitForFunction(() => document.getElementById('foto').naturalWidth > 0);
  await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
  const menu = page.locator('.sn-menu');
  await expect(menu.locator('.sn-menu-link-body')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(3000);
  const riga = menu.locator('.sn-menu-origine');
  const testo = (await riga.isVisible()) ? await riga.getAttribute('aria-label') : '';
  expect(testo || '').not.toMatch(/non è valida/);
});
