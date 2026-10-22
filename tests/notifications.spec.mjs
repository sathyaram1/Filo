// Notifiche/toast in basso a destra della shell (spec #170.1). La pila della shell è il modello;
// quello che l'utente vede e clicca è la vista sopra la pagina (#588.5), e si prova lì.
//
// Verifica il COMPORTAMENTO della feature, non un messaggio:
//   1) una notifica a tempo (durata finita) sparisce da sola dopo il timeout;
//   2) una notifica infinita (durata 0) RESTA e si chiude solo premendo la X;
//   3) la durata configurata nelle Preferenze viene rispettata dalla shell
//      (config letta dalle impostazioni, non hard-coded);
//   4) oltre il tetto nessun avviso si perde: aspetta dietro il «+N» (#1477).
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

  // 1) A schermo restano le più recenti; le altre aspettano dietro il «+N» in cima.
  await expect(vista.locator('.shell-notif')).toHaveCount(5);
  await expect(vista.locator('.shell-notif-msg').last()).toContainText('Sito bloccato #20');
  const altre = vista.locator('.avvisi-testa [data-pila="apri"]');
  await expect(altre).toHaveText('+16 avvisi');

  // 2) La vista sta dentro la finestra, sotto la barra delle schede: non copre schede né pulsanti.
  const posa = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const [W, H] = win.getContentSize();
    return { b: win._filoTabs.avvisi.vista.getBounds(), W, H, alto: win._filoTabs._altezzaCornice() };
  });
  const dentro = async () => {
    await expect.poll(async () => (await posa()).b.height).toBeGreaterThan(0);
    const p = await posa();
    expect(p.b.y).toBeGreaterThanOrEqual(p.alto);
    expect(p.b.y + p.b.height).toBeLessThanOrEqual(p.H);
    expect(p.b.x + p.b.width).toBeLessThanOrEqual(p.W);
  };
  await dentro();

  // 3) La più recente è in vista con la sua X, e le altre si raggiungono scorrendo.
  const ultima = vista.locator('.shell-notif').last();
  await expect(ultima.locator('.shell-notif-close')).toBeInViewport();
  await vista.locator('.shell-notif').first().locator('.shell-notif-close').scrollIntoViewIfNeeded();
  await expect(vista.locator('.shell-notif').first().locator('.shell-notif-close')).toBeInViewport();

  // 4) La X chiude davvero quella notifica, e al suo posto entra la più recente di quelle che aspettavano.
  await vista.locator('.shell-notif').first().locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif')).toHaveCount(20, { timeout: 4000 });
  await expect(vista.locator('.shell-notif-msg', { hasText: 'Sito bloccato #16,' })).toHaveCount(0);
  await expect(vista.locator('.shell-notif')).toHaveCount(5);
  await expect(vista.locator('.shell-notif-msg').first()).toContainText('Sito bloccato #15,');
  await expect(altre).toHaveText('+15 avvisi');

  // 5) «+15» le mostra tutte, la più vecchia in vista; la vista resta dentro la finestra.
  await altre.click();
  await expect(vista.locator('.shell-notif')).toHaveCount(20);
  await expect(vista.locator('.shell-notif-msg', { hasText: 'Sito bloccato #0,' })).toBeInViewport();
  await dentro();

  // 6) Riduci torna alle cinque più recenti; Chiudi tutti le chiude tutte, anche quelle che aspettavano.
  await vista.locator('.avvisi-testa [data-pila="riduci"]').click();
  await expect(vista.locator('.shell-notif')).toHaveCount(5);
  await expect(altre).toHaveText('+15 avvisi');
  await altre.click();
  await expect(vista.locator('.shell-notif')).toHaveCount(20);
  await vista.locator('.avvisi-testa [data-pila="chiudi-tutti"]').click();
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
  await expect(vista.locator('.shell-notif')).toHaveCount(0);
});

// #1477 — oltre il tetto un avviso non sparisce senza traccia: aspetta, e si ritrova.
test('sei avvisi a tempo di fila: il primo aspetta dietro «+1» e compare quando gli altri se ne vanno', async ({ shell, avvisi }) => {
  // La vista nasce col primo avviso: la si fa nascere prima, così i tempi della prova sono quelli degli avvisi.
  await shell.evaluate(() => window.filoNotify('pronto', { durationSec: 1 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif-msg', { hasText: 'pronto' })).toBeVisible();
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });

  await shell.evaluate(() => {
    for (let i = 1; i <= 6; i++) window.filoNotify('Avviso ' + i, { durationSec: 2 });
  });
  await expect(vista.locator('.shell-notif')).toHaveCount(5);
  await expect(vista.locator('.shell-notif-msg').last()).toHaveText('Avviso 6');
  await expect(vista.locator('.shell-notif-msg', { hasText: 'Avviso 1' })).toHaveCount(0);
  await expect(vista.locator('.avvisi-testa [data-pila="apri"]')).toHaveText('+1 avviso');

  // Il suo tempo non corre finché aspetta: se ne vanno le altre cinque, e lui si fa vedere per intero.
  const primo = vista.locator('.shell-notif.show .shell-notif-msg', { hasText: 'Avviso 1' });
  await expect(primo).toBeVisible({ timeout: 6000 });
  await expect(vista.locator('.shell-notif-msg', { hasText: 'Avviso 6' })).toHaveCount(0);
  await expect(vista.locator('.avvisi-testa')).toBeHidden();
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 6000 });
});

test('sei avvisi che restano: «+1» mostra il primo, Riduci lo rimette dietro, chiuderne uno lo fa entrare', async ({ shell, avvisi }) => {
  await shell.evaluate(() => {
    window.filoNotify('Avviso 1', { durationSec: 0, unica: 'primo' });
    for (let i = 2; i <= 6; i++) window.filoNotify('Avviso ' + i, { durationSec: 0 });
  });
  const vista = await avvisi();
  const altre = vista.locator('.avvisi-testa [data-pila="apri"]');
  await expect(vista.locator('.shell-notif')).toHaveCount(5);
  await expect(altre).toHaveText('+1 avviso');

  await altre.click();
  await expect(vista.locator('.shell-notif')).toHaveCount(6);
  await expect(vista.locator('.shell-notif-msg').first()).toHaveText('Avviso 1');
  await expect(vista.locator('.shell-notif-msg').last()).toHaveText('Avviso 6');
  await vista.locator('.avvisi-testa [data-pila="riduci"]').click();
  await expect(vista.locator('.shell-notif')).toHaveCount(5);
  await expect(vista.locator('.shell-notif-msg', { hasText: 'Avviso 1' })).toHaveCount(0);

  // Rinnovato mentre aspetta (lo stesso avviso che ritorna), è la notizia più fresca: torna in vista in fondo.
  await shell.evaluate(() => window.filoNotify('Avviso 1, di nuovo', { durationSec: 0, unica: 'primo' }));
  await expect(vista.locator('.shell-notif-msg').last()).toHaveText('Avviso 1, di nuovo');
  await expect(vista.locator('.shell-notif-msg', { hasText: 'Avviso 2' })).toHaveCount(0);
  await expect(altre).toHaveText('+1 avviso');

  // Chiuso uno a schermo, quello che aspettava entra e il «+1» se ne va.
  await vista.locator('.shell-notif', { hasText: 'Avviso 6' }).locator('.shell-notif-close').click();
  await expect(vista.locator('.shell-notif-msg', { hasText: 'Avviso 2' })).toBeVisible();
  await expect(vista.locator('.shell-notif')).toHaveCount(5);
  await expect(vista.locator('.avvisi-testa')).toBeHidden();
});

test('tasto destro sul «+N» e su una carta: Mostra tutti e Chiudi tutti fanno quello che fanno i pulsanti', async ({ app, shell, avvisi }) => {
  await shell.evaluate(() => {
    for (let i = 1; i <= 7; i++) window.filoNotify('Avviso ' + i, { durationSec: 0 });
  });
  const vista = await avvisi();
  const altre = vista.locator('.avvisi-testa [data-pila="apri"]');
  await expect(altre).toHaveText('+2 avvisi');
  const menuCon = async (voce) => {
    let menu = null;
    await expect.poll(async () => {
      for (const w of app.windows()) {
        try { if (await w.evaluate((v) => [...document.querySelectorAll('button.item')].some((b) => b.textContent.trim() === v), voce)) { menu = w; return true; } } catch (_) {}
      }
      return false;
    }, { timeout: 8_000 }).toBe(true);
    return menu;
  };
  const voci = (menu) => menu.evaluate(() => [...document.querySelectorAll('button.item')].map((b) => b.textContent.trim()));
  const scegli = (menu, voce) => menu.evaluate((v) => [...document.querySelectorAll('button.item')].find((b) => b.textContent.trim() === v).click(), voce);

  await altre.click({ button: 'right' });
  let menu = await menuCon('Mostra tutti');
  expect(await voci(menu)).toEqual(['Mostra tutti', 'Chiudi tutti']);
  await scegli(menu, 'Mostra tutti');
  await expect(vista.locator('.shell-notif')).toHaveCount(7);

  await vista.locator('.shell-notif-msg', { hasText: 'Avviso 7' }).click({ button: 'right' });
  menu = await menuCon('Chiudi tutti');
  expect(await voci(menu)).toEqual(['Chiudi', 'Chiudi tutti']);
  await scegli(menu, 'Chiudi tutti');
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
  await expect(vista.locator('.shell-notif')).toHaveCount(0);
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
