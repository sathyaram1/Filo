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

test('una raffica di notifiche non straripa fuori schermo e resta chiudibile', async ({ shell }) => {
  // Simula il caso del feedback #282: tante notifiche infinite (durata 0) in
  // rapida successione, come una tempesta di blocchi sito o un ripristino con
  // molte schede in blacklist. Senza tetto/overflow lo stack cresceva oltre la
  // finestra e le più vecchie finivano fuori dallo schermo in alto, con la loro
  // X irraggiungibile.
  await shell.evaluate(() => {
    for (let i = 0; i < 21; i++) {
      window.filoNotify('Sito bloccato #' + i, {
        durationSec: 0,
        actions: [{ label: 'Apri comunque', onClick: () => {} }],
      });
    }
  });

  // 1) Lo stack è limitato: non si accumulano 21 card senza fine.
  const count = await shell.locator('.shell-notif').count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(5);

  // 2) COMPORTAMENTO: ogni notifica rimasta è dentro la finestra e la sua X è
  //    davvero raggiungibile (rettangolo interamente nel viewport, non spinto
  //    oltre il bordo alto). È questo l'assert che diventa rosso senza il fix.
  const offscreen = await shell.evaluate(() => {
    const h = window.innerHeight;
    const w = window.innerWidth;
    const bad = [];
    for (const x of document.querySelectorAll('.shell-notif-close')) {
      const r = x.getBoundingClientRect();
      if (r.top < 0 || r.bottom > h || r.left < 0 || r.right > w) {
        bad.push({ top: r.top, bottom: r.bottom });
      }
    }
    return bad;
  });
  expect(offscreen).toEqual([]);

  // 3) La X dell'ultima notifica visibile la chiude davvero (è cliccabile).
  const before = await shell.locator('.shell-notif').count();
  await shell.locator('.shell-notif').last().locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif')).toHaveCount(before - 1, { timeout: 4000 });
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
