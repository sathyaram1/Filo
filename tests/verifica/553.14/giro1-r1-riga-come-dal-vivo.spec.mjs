// #553.14 giro 1, rilievo 1: riletta da una scheda nuova, la riga della home già aperta dice quello che diceva dal vivo
// («Sei già nella home»), non un comando fallito col triangolo d'avviso.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

test('r1 la home già aperta, riletta, si racconta come dal vivo e non come un comando non eseguito', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'h1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
    { text: 'Sei già qui, nella home.' },
  ]);
  await chiedi(page, 'portami alla home');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' });
  await expect(bolla).toBeVisible({ timeout: 10_000 });
  await page.locator('.dash-activity .dash-activity-head').click();
  const dalVivo = page.locator('.dash-activity .dash-activity-body .dash-activity-row', { hasText: 'Sei già nella home' });
  await expect(dalVivo).toHaveCount(1);
  await expect(dalVivo).not.toContainText(/non eseguito|non riuscit/i);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.chats())
    .some((c) => c.messages.some((m) => m.role === 'filo' && /Sei già qui/.test(m.text))))).toBe(true);

  const nuova = await openTab('filo://newtab/');
  const riletta = nuova.locator('#bubbles .dash-bubble-filo', { hasText: 'Sei già qui' }).locator('.dash-activity-row');
  await expect(riletta).toHaveCount(1, { timeout: 10_000 });
  await expect(riletta).toContainText('Sei già nella home');
  await expect(riletta, 'riletta, la home già aperta non è un comando fallito').not.toContainText(/non eseguito|non riuscit|⚠/i);
  await ripristina(app);
});
