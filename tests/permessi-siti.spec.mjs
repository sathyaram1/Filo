// Permessi chiesti dai siti (#586): la fotocamera, il microfono, la posizione,
// le notifiche, gli appunti e lo schermo NON se li prende il sito — li decide
// chi naviga.
//
// Prima di questa prova Electron concedeva per default: senza un gestore
// installato, una pagina qualunque apriva webcam e microfono e mandava
// notifiche senza che comparisse niente. Qui si asserisce il SUCCESSO dal punto
// di vista di chi usa Filo:
//   • una pagina appena aperta NON ha già i permessi in mano;
//   • quando li chiede compare la pastiglia col nome del sito e cosa vuole;
//   • "Nega" arriva alla pagina come un rifiuto vero, e resta ricordato (la
//     seconda richiesta non ridisturba);
//   • "Consenti" arriva come permesso vero, e da lì la pagina lo vede concesso;
//   • tolta la risposta, il sito torna a doverla chiedere.
//
// Senza il fix il primo assert è già rosso: i permessi risultano concessi prima
// ancora che qualcuno abbia chiesto qualcosa.

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0">
<p id="p">pagina di prova</p>
<script>
  window.__chiediFotocamera = () => {
    window.__cam = navigator.mediaDevices.getUserMedia({ video: true })
      .then((s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return 'ok'; },
            (e) => e && e.name ? e.name : 'errore');
  };
  window.__chiediNotifiche = () => { window.__notif = Notification.requestPermission(); };
  window.__stato = async (nome) => {
    try { return (await navigator.permissions.query({ name: nome })).state; }
    catch (_) { return 'non-supportato'; }
  };
</script>
</body></html>`;

const pastiglia = (shell) => shell.locator('.perm-chip');

test('un sito non si prende fotocamera e notifiche da solo: decide chi naviga, e la scelta resta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, HTML);
  const origine = new URL(page.url()).origin;
  const host = new URL(page.url()).host;

  // 1. Appena aperta, la pagina NON ha niente in mano. (Senza il gestore
  //    Electron risponde "granted" a tutte e tre: questo assert è il rosso.)
  for (const nome of ['camera', 'microphone', 'geolocation', 'notifications']) {
    const stato = await page.evaluate((n) => window.__stato(n), nome);
    expect(stato, `permesso "${nome}" concesso senza che nessuno lo abbia chiesto`).not.toBe('granted');
  }
  expect(await page.evaluate(() => Notification.permission)).not.toBe('granted');

  // 2. La pagina chiede la fotocamera → compare la pastiglia, col nome del sito
  //    e cosa vuole. Finché è lì, la pagina non ha il permesso.
  await page.evaluate(() => window.__chiediFotocamera());
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(pastiglia(shell)).toContainText(host);
  await expect(pastiglia(shell)).toContainText('fotocamera');

  // 3. "Nega" arriva alla pagina come un rifiuto vero.
  await shell.locator('.perm-chip .perm-chip-btn', { hasText: 'Nega' }).click();
  await expect(pastiglia(shell)).toHaveCount(0, { timeout: 8_000 });
  expect(await page.evaluate(() => window.__cam)).toBe('NotAllowedError');

  // 4. La risposta è ricordata: la stessa richiesta non ridisturba più.
  await page.evaluate(() => window.__chiediFotocamera());
  expect(await page.evaluate(() => window.__cam)).toBe('NotAllowedError');
  await page.waitForTimeout(500);
  await expect(pastiglia(shell)).toHaveCount(0);

  // 5. "Consenti" sulle notifiche: la pagina riceve il permesso davvero, e da
  //    lì lo vede concesso.
  await page.evaluate(() => window.__chiediNotifiche());
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(pastiglia(shell)).toContainText('notifiche');
  await shell.locator('.perm-chip .perm-chip-allow').click();
  await expect(pastiglia(shell)).toHaveCount(0, { timeout: 8_000 });
  expect(await page.evaluate(() => window.__notif)).toBe('granted');
  expect(await page.evaluate(() => Notification.permission)).toBe('granted');
  expect(await page.evaluate(() => window.__stato('notifications'))).toBe('granted');

  // 6. Le due risposte sono scritte dove l'utente può rivederle (Impostazioni →
  //    Sicurezza legge di lì).
  const ricordate = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  expect(ricordate[origine]).toEqual({ fotocamera: 'deny', notifiche: 'allow' });

  // 7. Tolta la risposta, il sito torna a doverla chiedere: la pagina non la
  //    vede più concessa e la richiesta successiva rifà comparire la pastiglia.
  await shell.evaluate((o) => window.filoShell.permissions.revoke(o, null), origine);
  await expect.poll(
    () => page.evaluate(() => window.__stato('notifications')),
    { timeout: 8_000 },
  ).not.toBe('granted');
  await page.evaluate(() => window.__chiediFotocamera());
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 10_000 });

  // La × chiude senza decidere: il permesso NON passa, ma non resta scritto
  // niente (la volta dopo si richiede).
  await shell.locator('.perm-chip .perm-chip-x').click();
  await expect(pastiglia(shell)).toHaveCount(0, { timeout: 8_000 });
  expect(await page.evaluate(() => window.__cam)).toBe('NotAllowedError');
  const dopoLaX = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  expect(dopoLaX[origine]).toBeUndefined();
});

test('ogni partizione nuova nasce col gestore dei permessi addosso', async ({ app, shell }) => {
  void shell; // attende il boot
  // Comprese quelle che Electron crea da sé (incognito, jar per-sito della
  // modalità privacy, schede proxate, sandbox del safebrowse): l'aggancio è su
  // `session-created`, non sui singoli punti di creazione. `_filoPermessi` è il
  // marchio che il gestore lascia sulla sessione che ha già protetto.
  const esiti = await app.evaluate(({ session }) => ({
    predefinita: !!session.defaultSession._filoPermessi,
    effimera: !!session.fromPartition('prova-permessi-' + Date.now())._filoPermessi,
    persistente: !!session.fromPartition('persist:prova-permessi-' + Date.now())._filoPermessi,
  }));
  expect(esiti).toEqual({ predefinita: true, effimera: true, persistente: true });
});
