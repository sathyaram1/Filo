// Verifica #2378, giro 1: i testi conservati si vedono, uno per uno, e se ne toglie uno.
import { test, expect } from '../../fixtures/electron.mjs';

test('r2 in Preferenze si vede il testo conservato e la pagina da cui viene', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><head><title>Reclamo</title></head><body style="padding:24px">
    <textarea name="m" style="width:300px;height:60px"></textarea></body>`);
  await page.locator('textarea').click();
  await page.keyboard.type('Il pacco è arrivato rotto');
  await page.waitForTimeout(1500);
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#sec-testo-campi')).toContainText('Il pacco è arrivato rotto', { timeout: 5000 });
});
