// Notifiche/toast in basso a destra della shell (spec #170.1).
//
// Verifica il COMPORTAMENTO della feature, non un messaggio:
//   1) una notifica a tempo (durata finita) sparisce da sola dopo il timeout;
//   2) una notifica infinita (durata 0) RESTA e si chiude solo premendo la X;
//   3) la durata configurata nelle Preferenze viene rispettata dalla shell
//      (config letta dalle impostazioni, non hard-coded).
//
// Il sistema è esposto sulla shell come window.filoNotify(text, opts): gli
// stessi blocchi #170.2/#170.3 lo useranno per segnalare gli eventi.

import { test, expect } from './fixtures/electron.mjs';

test('notifica a tempo sparisce dopo il timeout', async ({ shell }) => {
  await shell.evaluate(() => window.filoNotify('Notifica a tempo', { durationSec: 1 }));

  const card = shell.locator('.shell-notif.show');
  await expect(card.locator('.shell-notif-msg')).toHaveText('Notifica a tempo');

  // Si chiude da sola: dopo ~1s + transizione non c'è più nel DOM.
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
});

test('notifica infinita resta e si chiude solo con la X', async ({ shell }) => {
  await shell.evaluate(() => window.filoNotify('Notifica infinita', { durationSec: 0 }));

  const card = shell.locator('.shell-notif.show');
  await expect(card.locator('.shell-notif-msg')).toHaveText('Notifica infinita');

  // Aspetta oltre qualsiasi auto-dismiss plausibile: deve ancora esserci.
  await shell.waitForTimeout(1500);
  await expect(card).toBeVisible();
  await expect(card.locator('.shell-notif-close')).toBeVisible();

  // La X la chiude.
  await card.locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
});

test('Preferenze: i controlli notifiche esistono e persistono', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#notifDuration', { timeout: 8_000 });

  // I controlli della sezione esistono.
  await expect(page.locator('#notifDuration')).toHaveCount(1);
  await expect(page.locator('#notifSoundEnabled')).toHaveCount(1);
  await expect(page.locator('#notifSound')).toHaveCount(1);
  await expect(page.locator('#notifSoundPreview')).toHaveCount(1);
  // Il select dei suoni è popolato con le stesse voci di SN_SOUNDS.
  await expect(page.locator('#notifSound option')).toHaveCount(4);

  // Imposta durata infinita (0) + suono attivo e attende il salvataggio.
  await page.locator('#notifDuration').fill('0');
  await page.locator('#notifDuration').dispatchEvent('change');
  await page.locator('#notifSoundEnabled').check();

  await expect
    .poll(() => page.evaluate(async () => {
      const n = (await window.SN_STORAGE.getSettings()).notifications || {};
      return [n.durationSec, n.soundEnabled];
    }), { timeout: 4000 })
    .toEqual([0, true]);

  // Sopravvive a una ricarica.
  await page.reload();
  await page.waitForSelector('#notifDuration', { timeout: 8_000 });
  await expect(page.locator('#notifDuration')).toHaveValue('0');
  await expect(page.locator('#notifSoundEnabled')).toBeChecked();
});

test('la durata configurata nelle Preferenze viene rispettata', async ({ shell }) => {
  // Imposta durata infinita (0) nelle impostazioni e propaga la config alla
  // shell come fa il broadcast settings_updated dopo il salvataggio.
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { notifications: { durationSec: 0, soundEnabled: false, sound: 'default' } },
  }));
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));

  // Senza opts la notifica eredita la config: durata 0 => resta.
  await shell.evaluate(() => window.filoNotify('Eredita config'));
  const card = shell.locator('.shell-notif.show', { hasText: 'Eredita config' });
  await expect(card).toBeVisible();
  await shell.waitForTimeout(1500);
  await expect(card).toBeVisible();

  await card.locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif', { hasText: 'Eredita config' })).toHaveCount(0, { timeout: 4000 });
});
