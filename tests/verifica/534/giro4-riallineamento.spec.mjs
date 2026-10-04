// Verifica #534 dopo il riallineamento: l'interruttore spostato nella fonte unica delle impostazioni si spegne
// dalla chat con la sua conferma, e un'azione sulle schede fallita dice il suo motivo breve nel diario.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, aspettaConfermaPronta, clickConfirm, confirmText } from '../../helpers/confirm.mjs';

test('dalla chat «spegni la lettura delle schede» chiede l\'OK, spegne, e la posta senza Gmail aperto dice perché non parte', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'leggere le schede', valore: 'false' }) }] },
    { text: 'Ti chiedo conferma.' },
  ]);
  await chiedi(page, 'non leggere più le mie schede');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  expect(await confirmText(page)).toContain('Da spenta, Filo non legge nessuna scheda');
  await aspettaConfermaPronta(page);
  await clickConfirm(page, 'ok');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).schedeAperte), { timeout: 8_000 })
    .toEqual({ leggere: false });

  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ schedeAperte: { leggere: true } }));
  await modelloFinto(app, [
    { toolCalls: [{ id: 'x1', name: 'POSTA_ELENCO', arguments: '{}' }] },
    { text: 'Va riaccesa nelle Preferenze.' },
  ]);
  await chiedi(page, 'ho mail nuove?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Va riaccesa' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.dash-activity-row', { hasText: 'Posta non letta · nessuna scheda adatta aperta' }).first())
    .toBeAttached({ timeout: 8_000 });
});
