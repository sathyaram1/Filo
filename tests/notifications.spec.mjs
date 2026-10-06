// Notifiche/toast in basso a destra della shell (spec #170.1). La pila della shell è il modello;
// quello che l'utente vede e clicca è la vista sopra la pagina (#588.5), e si prova lì.
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

test('notifica a tempo sparisce dopo il timeout', async ({ shell, avvisi }) => {
  await shell.evaluate(() => window.filoNotify('Notifica a tempo', { durationSec: 1 }));

  const vista = await avvisi();
  const card = vista.locator('.shell-notif.show');
  await expect(card.locator('.shell-notif-msg')).toHaveText('Notifica a tempo');

  // Si chiude da sola: dopo ~1s + transizione non c'è più, né nel modello né a schermo.
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
  await expect(vista.locator('.shell-notif')).toHaveCount(0);
});

test('notifica infinita resta e si chiude solo con la X', async ({ shell, avvisi }) => {
  await shell.evaluate(() => window.filoNotify('Notifica infinita', { durationSec: 0 }));

  const vista = await avvisi();
  const card = vista.locator('.shell-notif.show');
  await expect(card.locator('.shell-notif-msg')).toHaveText('Notifica infinita');

  // Aspetta oltre qualsiasi auto-dismiss plausibile: deve ancora esserci.
  await vista.waitForTimeout(1500);
  await expect(card).toBeVisible();
  await expect(card.locator('.shell-notif-close')).toBeVisible();

  // La X la chiude.
  await card.locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
  await expect(vista.locator('.shell-notif')).toHaveCount(0);
});

test('una raffica di notifiche non straripa fuori schermo e resta chiudibile', async ({ app, shell, avvisi }) => {
  // Caso del feedback #282: tante notifiche infinite in rapida successione (tempesta di blocchi
  // sito, ripristino con molte schede in blacklist), in una finestra bassa. Senza tetto lo stack
  // cresceva oltre la finestra e le più vecchie finivano fuori, con la loro X irraggiungibile.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs).setContentSize(760, 520);
  });
  await shell.evaluate(() => {
    for (let i = 0; i < 21; i++) {
      window.filoNotify('Sito bloccato #' + i + ', con un testo abbastanza lungo da andare a capo', {
        durationSec: 0,
        actions: [{ label: 'Apri comunque', onClick: () => {} }],
      });
    }
  });
  const vista = await avvisi();

  // 1) Lo stack è limitato, e restano le più recenti.
  await expect(vista.locator('.shell-notif')).toHaveCount(5);
  await expect(vista.locator('.shell-notif-msg').last()).toContainText('Sito bloccato #20');

  // 2) La vista sta dentro la finestra, sotto la barra delle schede: non copre schede né pulsanti.
  const posa = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const [W, H] = win.getContentSize();
    return { b: win._filoTabs.avvisi.vista.getBounds(), W, H, alto: win._filoTabs._altezzaCornice() };
  });
  await expect.poll(async () => (await posa()).b.height).toBeGreaterThan(0);
  const p = await posa();
  expect(p.b.y).toBeGreaterThanOrEqual(p.alto);
  expect(p.b.y + p.b.height).toBeLessThanOrEqual(p.H);
  expect(p.b.x + p.b.width).toBeLessThanOrEqual(p.W);

  // 3) La più recente è in vista con la sua X, e le altre si raggiungono scorrendo.
  const ultima = vista.locator('.shell-notif').last();
  await expect(ultima.locator('.shell-notif-close')).toBeInViewport();
  await vista.locator('.shell-notif').first().locator('.shell-notif-close').scrollIntoViewIfNeeded();
  await expect(vista.locator('.shell-notif').first().locator('.shell-notif-close')).toBeInViewport();

  // 4) La X chiude davvero quella notifica.
  await vista.locator('.shell-notif').first().locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif')).toHaveCount(4, { timeout: 4000 });
  await expect(vista.locator('.shell-notif')).toHaveCount(4);
  await expect(vista.locator('.shell-notif-msg', { hasText: 'Sito bloccato #16,' })).toHaveCount(0);
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

test('la durata configurata nelle Preferenze viene rispettata', async ({ shell, avvisi }) => {
  // Imposta durata infinita (0) nelle impostazioni e propaga la config alla
  // shell come fa il broadcast settings_updated dopo il salvataggio.
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { notifications: { durationSec: 0, soundEnabled: false, sound: 'default' } },
  }));
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));

  // Senza opts la notifica eredita la config: durata 0 => resta.
  await shell.evaluate(() => window.filoNotify('Eredita config'));
  const vista = await avvisi();
  const card = vista.locator('.shell-notif.show', { hasText: 'Eredita config' });
  await expect(card).toBeVisible();
  await vista.waitForTimeout(1500);
  await expect(card).toBeVisible();

  await card.locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif', { hasText: 'Eredita config' })).toHaveCount(0, { timeout: 4000 });
});
