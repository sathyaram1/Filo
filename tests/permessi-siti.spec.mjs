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
  window.__chiediPosizione = () => {
    window.__pos = new Promise((res) => navigator.geolocation.getCurrentPosition(
      () => res('ok'), (e) => res('errore:' + e.code)));
  };
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

test('due richieste insieme: una domanda alla volta, e ognuna vale per sé', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, HTML);
  const origine = new URL(page.url()).origin;

  // La fascia sotto la barra è alta una pastiglia: due domande impilate
  // spingerebbero la seconda dietro all'area della pagina, dove nessuno può
  // rispondere. Quindi si chiede una cosa alla volta.
  await page.evaluate(() => { window.__chiediFotocamera(); window.__chiediPosizione(); });
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 10_000 });
  // Quale delle due arrivi per prima al main non è deciso da noi (la fotocamera
  // passa prima dall'apertura del dispositivo): la prova guarda l'ordine che
  // vede, non uno che si aspetta.
  const primo = await pastiglia(shell).innerText();
  const primaLaFotocamera = /fotocamera/.test(primo);
  expect(primaLaFotocamera || /dove sei/.test(primo)).toBe(true);

  await shell.locator('.perm-chip .perm-chip-btn', { hasText: 'Nega' }).click();
  // Risposta alla prima: la seconda prende il suo posto, con la sua domanda.
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(pastiglia(shell)).toContainText(primaLaFotocamera ? 'dove sei' : 'fotocamera');
  await shell.locator('.perm-chip .perm-chip-allow').click();
  await expect(pastiglia(shell)).toHaveCount(0, { timeout: 8_000 });

  const ricordate = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  expect(ricordate[origine]).toEqual(primaLaFotocamera
    ? { fotocamera: 'deny', posizione: 'allow' }
    : { posizione: 'deny', fotocamera: 'allow' });
  // Il no dato a una non è il no dell'altra, e viceversa.
  expect(await page.evaluate(() => window.__cam)).toBe(primaLaFotocamera ? 'NotAllowedError' : 'ok');
});

// ── menu del tasto destro sulla scheda: la strada equivalente per revocare ──
// Il popup del menu è una finestra a sé che su headless si chiude da sola al
// primo soffio: si riapre finché l'esito osservabile non arriva (stessa tecnica
// di proxy-tab-menu.spec.mjs).
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

async function apriMenuScheda(shell) {
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + r.height / 2),
    }));
  });
}

async function testoDelPopup(app, pezzo) {
  for (const w of app.windows()) {
    try {
      const t = await w.evaluate((n) => (document.body && document.body.innerText.includes(n))
        ? document.body.innerText : null, pezzo);
      if (t != null) return t;
    } catch (_) {}
  }
  return null;
}

async function cliccaNelPopup(app, pezzo, etichetta) {
  for (const w of app.windows()) {
    try {
      const r = await w.evaluate(({ n, l }) => {
        if (!document.body || !document.body.innerText.includes(n)) return 'no';
        const b = [...document.querySelectorAll('button.item')].find((x) => new RegExp(l).test(x.textContent));
        if (!b) return 'no';
        b.click();
        return 'si';
      }, { n: pezzo, l: etichetta });
      if (r === 'si') return true;
    } catch (_) {}
  }
  return false;
}

test('la risposta si toglie anche dal tasto destro sulla scheda', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, HTML);
  const origine = new URL(page.url()).origin;

  // Una risposta già data (come se fosse arrivata dalla pastiglia).
  await app.evaluate(async (_e, o) => {
    // Dalla pagina Sicurezza: stesso canale, stesso choke point di scrittura.
    await globalThis.SN_HANDLE_MESSAGE(
      { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { security: { sitePermissions: { [o]: { fotocamera: 'allow' } } } } },
      { url: 'filo://security/security.html' },
    );
  }, origine);
  expect(await page.evaluate(() => window.__stato('camera'))).toBe('granted');

  // Il menu del tasto destro sulla scheda mostra la voce…
  await expect.poll(async () => {
    const t = await testoDelPopup(app, 'Permessi del sito');
    if (t) return true;
    await apriMenuScheda(shell);
    await attendi(150);
    return !!(await testoDelPopup(app, 'Permessi del sito'));
  }, { timeout: 20_000 }).toBe(true);

  // …e da lì si toglie: l'esito osservabile è che la pagina non vede più il
  // permesso concesso.
  const tolto = async () => (await page.evaluate(() => window.__stato('camera'))) !== 'granted';
  await expect.poll(async () => {
    if (await tolto()) return true;
    await apriMenuScheda(shell);
    await attendi(150);
    await cliccaNelPopup(app, 'Permessi del sito', 'Permessi del sito');
    await attendi(200);
    await cliccaNelPopup(app, 'Fotocamera', 'Fotocamera');
    await attendi(250);
    return await tolto();
  }, { timeout: 40_000 }).toBe(true);

  const ricordate = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  expect(ricordate[origine]).toBeUndefined();
});

test('dalle Impostazioni la risposta si cambia e si toglie', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const origine = 'https://esempio-permessi.test';
  await app.evaluate(async (_e, o) => {
    await globalThis.SN_HANDLE_MESSAGE(
      { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { security: { sitePermissions: { [o]: { fotocamera: 'allow' } } } } },
      { url: 'filo://security/security.html' },
    );
  }, origine);

  const page = await openTab('filo://security/');
  await page.waitForSelector('#perms-list', { timeout: 8_000 });
  const riga = page.locator('#perms-list li').first();
  await expect(riga).toContainText('esempio-permessi.test');
  await expect(riga).toContainText('Fotocamera');
  await expect(riga.locator('button').first()).toHaveText('Consentito');

  // Il bottone dice lo stato e, premuto, lo ribalta: si nega senza aspettare
  // che il sito richieda (l'altra metà dell'invariante "se si può dare si può
  // togliere").
  await riga.locator('button').first().click();
  await expect(riga.locator('button').first()).toHaveText('Negato');
  await expect.poll(async () => {
    const s = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.sitePermissions);
    return s[origine] && s[origine].fotocamera;
  }, { timeout: 8_000 }).toBe('deny');

  // La × toglie la risposta: la riga sparisce e lo storage resta senza il sito.
  await riga.locator('button').nth(1).click();
  await expect(page.locator('#perms-list li')).toHaveCount(1); // la riga "nessuna risposta"
  await expect(page.locator('#perms-list li').first()).toContainText('Nessun sito');
  await expect.poll(async () => {
    const s = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.sitePermissions);
    return Object.keys(s || {}).length;
  }, { timeout: 8_000 }).toBe(0);
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
