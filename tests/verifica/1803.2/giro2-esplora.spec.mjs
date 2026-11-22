// Esplorazione: senza il modulo della barra nella home, le righe diventano generiche?
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina } from '../../helpers/chatFinta.mjs';

test('senza modulo', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await page.evaluate(() => { delete window.SN_BARRA_SITI; });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'r0', name: 'BARRA_SITI', arguments: JSON.stringify({ operazione: 'metti', elemento: 'youtube.com', nome: 'YouTube' }) }] },
    { text: 'Risposta 0.' },
  ]);
  try {
    await page.locator('#input').fill('metti youtube nella barra');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta 0.' })).toHaveCount(1, { timeout: 10_000 });
    console.log('BOLLE', await page.locator('#bubbles').innerText());
    await page.locator('.dash-activity-head').first().click().catch(() => {});
    console.log('APERTO', await page.locator('#bubbles').innerText());
  } finally { await ripristina(app); }
});
