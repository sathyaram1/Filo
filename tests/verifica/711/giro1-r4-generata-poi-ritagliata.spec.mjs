// Verifica #711, giro 1, rilievo 4: un'immagine generata con l'AI e poi ritagliata in un
// programma che tiene le credenziali. Il manifesto dell'ultimo passo dice solo «aperta,
// ritagliata»; che fosse generata lo dice quello del passo prima, che il file si porta dietro.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const JPG = readFileSync(join(process.cwd(), 'tests', 'verifica', '711', 'credenziali-vere-ritagliata.jpg'));

test('generata con l’AI e poi ritagliata: la riga lo dice ancora', async ({ openTab, testServer }) => {
  const src = testServer.asset(JPG, 'image/jpeg');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <img id="foto" src="${src}" width="160" height="160">
  </body></html>`);
  await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  const riga = menu.locator('.sn-menu-origine');
  await expect(riga).toBeVisible({ timeout: 10000 });
  await expect(riga).toContainText(/con l.AI/);
});
