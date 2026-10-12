// Verifica #667.7 giro 1, rilievo 1: la spiegazione di un rifiuto non deve spostare i segmenti della catena.
import { test, expect } from '../../fixtures/electron.mjs';

const cella = (page, etichetta) => page.locator('#modelsGrid > div')
  .filter({ has: page.locator(':scope > label', { hasText: etichetta }) });

test('r1 la spiegazione del rifiuto sta sotto la catena e non manda a capo il modello di riserva', async ({ openTab }) => {
  const page = await openTab('filo://options/options.html');
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 6_000 });
  await page.waitForTimeout(1_000);

  const c = cella(page, 'Spiega (inline)');
  const segs = c.locator('.sn-chain-seg');
  expect(await segs.count()).toBeGreaterThan(1);
  const prima = await segs.nth(1).boundingBox();

  const input = segs.first().locator('.sn-chain-input');
  await input.click();
  await input.press('ControlOrMeta+a');
  await input.pressSequentially('kokoro', { delay: 20 });
  await page.keyboard.press('Tab');
  await expect(segs.first().locator('.sn-chain-msg')).toBeVisible({ timeout: 4_000 });
  await page.waitForTimeout(500);

  const dopo = await segs.nth(1).boundingBox();
  expect(Math.abs(dopo.y - prima.y), 'il modello di riserva resta sulla sua riga').toBeLessThan(2);
  expect(Math.abs(dopo.x - prima.x), 'il modello di riserva resta al suo posto').toBeLessThan(2);
});
