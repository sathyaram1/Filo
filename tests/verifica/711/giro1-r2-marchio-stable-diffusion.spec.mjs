// Verifica #711, giro 1, rilievo 2: il marchio invisibile aperto di Stable Diffusion.
// L'immagine accanto porta «StableDiffusionV1» scritto col metodo dwtDct della libreria
// invisible-watermark (quella dei programmi di riferimento), e nessun metadato.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PNG = readFileSync(join(process.cwd(), 'tests', 'verifica', '711', 'marchio-stable-diffusion.png'));

test('un’immagine col marchio invisibile di Stable Diffusion fa comparire la riga', async ({ openTab, testServer }) => {
  const src = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <img id="foto" src="${src}" width="256" height="256">
  </body></html>`);
  await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  const riga = menu.locator('.sn-menu-origine');
  await expect(riga).toBeVisible({ timeout: 10000 });
  await expect(riga).toContainText(/con l.AI/);
});
