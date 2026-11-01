// Verifica #1685 giro 1, rilievo 2: chiesti due passi, il modello propone il primo e aspetta l'OK; dato l'OK, Filo
// riprende da solo per fare il secondo, senza un «vai avanti».
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const TERMINALE = { id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":true}' };

test('r2 «accendi il terminale e poi lancia ls»: dopo l\'OK al primo passo Filo riprende per il secondo', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } }));
  await modelloFinto(app, [
    { text: '', toolCalls: [TERMINALE] },
    { text: 'RIPRESO DA SOLO: ora lancio ls.' },
  ]);
  await chiedi(page, 'accendi il terminale e poi lancia ls');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  const prima = (await chiamateAlModello(app)).length;
  await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'danger');
  await expect(page.locator('.dash-action-btn', { hasText: /^✓/ })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 8_000, message: 'dopo l\'OK il lavoro riprende' }).toBeGreaterThan(prima);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RIPRESO DA SOLO' })).toBeVisible({ timeout: 10_000 });
  await ripristina(app);
});
