// #870 giro 5, rilievo 2: «Sposta su» offerto sulla carta sotto i Crediti deve spostarla, o non essere offerto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, ordine } from './_comune.mjs';

test('la carta subito sotto i Crediti: «Sposta su» o non c’è o sposta davvero', async ({ app }) => {
  const page = await home(app);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Pasta', seconds: 900 });
  });
  await page.reload();
  await home(app);
  await expect.poll(() => ordine(page, 'accade')).toEqual(['crediti', 'timer']);
  await page.locator('#accade .dash-carta[data-tipo="timer"]').click({ button: 'right', position: { x: 30, y: 12 } });
  const voce = page.locator('.dash-menu .dash-menu-voce', { hasText: 'Sposta su' });
  if (await voce.count() === 0) return;
  await voce.click();
  await expect.poll(() => ordine(page, 'accade')).toEqual(['timer', 'crediti']);
});
