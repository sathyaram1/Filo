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

test('una pagina web non può scriversi da sola la risposta che non ha ottenuto', async ({ app, shell }) => {
  void shell; // attende il boot: il gestore dei messaggi dev'essere montato
  // Il canale delle impostazioni serve anche ai content script (il modello
  // della dettatura si sceglie dal menu del tasto destro su una pagina), quindi
  // non è chiuso in blocco: chiuse sono le chiavi API e, da qui, le risposte sui
  // permessi. Senza questa serratura una pagina ostile si darebbe la fotocamera
  // scrivendosi un "allow" invece di chiederlo.
  const esito = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    await globalThis.SN_HANDLE_MESSAGE(
      { type: MSG.UPDATE_SETTINGS, settings: { security: { sitePermissions: { 'https://ostile.test': { fotocamera: 'allow' } } } } },
      { url: 'https://ostile.test/pagina' },
    );
    const dopoWeb = (await globalThis.SN_STORAGE.getSettings()).security.sitePermissions || {};
    // La stessa scrittura da una pagina di Filo (le Impostazioni) passa: la
    // serratura è sull'origine, non sulla funzione.
    await globalThis.SN_HANDLE_MESSAGE(
      { type: MSG.UPDATE_SETTINGS, settings: { security: { sitePermissions: { 'https://ostile.test': { fotocamera: 'allow' } } } } },
      { url: 'filo://security/security.html' },
    );
    const dopoFilo = (await globalThis.SN_STORAGE.getSettings()).security.sitePermissions || {};
    return { web: dopoWeb['https://ostile.test'] || null, filo: dopoFilo['https://ostile.test'] || null };
  });
  expect(esito.web).toBeNull();
  expect(esito.filo).toEqual({ fotocamera: 'allow' });
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

// ─── giro di verifica 1 ─────────────────────────────────────────────────────
//
// Quattro difetti trovati provando a rompere la difesa, e le guardie che li
// tengono chiusi. Stanno qui, accanto alle altre, perché la suite le rilanci
// per sempre: nella cartella del giro sarebbero verdi il giorno che le scrivo e
// mai più.

const SCHERMO_HTML = `<!doctype html><html><body style="margin:0">
<button id="b" style="font:16px sans-serif;padding:20px">condividi lo schermo</button>
<script>
  document.getElementById('b').addEventListener('click', () => {
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(
      (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} window.__r = 'ok'; },
      (e) => { window.__r = (e && e.name) ? e.name : 'errore'; });
  });
  window.__stato = async (n) => {
    try { return (await navigator.permissions.query({ name: n })).state; } catch (_) { return 'n/d'; }
  };
</script></body></html>`;

test('condividere lo schermo non regala fotocamera e microfono ────────────', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  // Prima di una condivisione dello schermo Chromium manda una richiesta
  // audio/video con la lista dei tipi VUOTA. Letta come "tipo non dichiarato",
  // faceva comparire «vuole usare la fotocamera e il microfono» a chi aveva
  // premuto «condividi lo schermo»: il suo «Consenti» lasciava quei due sensori
  // concessi per SEMPRE, e da lì il sito li accendeva senza chiedere più nulla.
  const page = await testServer.openReady(openTab, SCHERMO_HTML);
  const origine = new URL(page.url()).origin;

  await page.click('#b');
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 15_000 });
  await expect(pastiglia(shell)).toContainText('schermo');
  await expect(pastiglia(shell)).not.toContainText('fotocamera');

  await shell.locator('.perm-chip .perm-chip-allow').click();
  // Consentito: si sceglie COSA far vedere, invece di consegnare sempre tutto.
  await expect(shell.locator('.perm-source')).toHaveCount(1, { timeout: 15_000 });
  expect(await shell.locator('.perm-source .perm-source-item').count()).toBeGreaterThan(0);
  await shell.locator('.perm-source .perm-source-cancel').click();
  await page.waitForTimeout(800);

  // Niente resta scritto: nemmeno lo schermo (si richiede ogni volta), e men
  // che meno fotocamera e microfono.
  const ricordate = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  expect(ricordate[origine]).toBeUndefined();
  expect(await page.evaluate(() => window.__stato('camera'))).toBe('prompt');
});

test('la domanda non finisce sotto l\'area della pagina ──────────────────', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  // L'area della pagina è una vista nativa composta SOPRA la cornice di Filo.
  // La pastiglia nasce dentro quella zona: se non fa scendere la pagina esiste
  // nel documento e non la vede nessuno, e dopo due minuti la richiesta viene
  // negata da sola — cioè fotocamera, microfono, posizione, notifiche, appunti
  // e schermo non funzionano su nessun sito, senza una riga che lo spieghi.
  const page = await testServer.openReady(openTab, HTML);
  const cima = () => app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm) continue;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      if (t) return t.view.getBounds().y;
    }
    return null;
  });

  const prima = await cima();
  await page.evaluate(() => window.__chiediFotocamera());
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 10_000 });
  await shell.waitForTimeout(500);
  const box = await pastiglia(shell).boundingBox();
  expect(await cima(), 'la pagina deve scendere sotto la domanda').toBeGreaterThanOrEqual(box.y + box.height);

  // E risale quando si risponde: la riserva non resta appesa.
  await shell.locator('.perm-chip .perm-chip-x').click();
  await expect(pastiglia(shell)).toHaveCount(0, { timeout: 8_000 });
  await expect.poll(cima, { timeout: 8_000 }).toBe(prima);
});

test('la domanda resta legata alla scheda che l\'ha fatta ─────────────────', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  // Con una fila sola per tutta la finestra, una scheda in secondo piano teneva
  // il posto: la richiesta della scheda che si stava guardando non compariva, e
  // chi premeva «trovami» non otteneva niente.
  const urlA = testServer.html(HTML);
  const urlB = testServer.html(HTML);
  const apri = async (url) => {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const fine = Date.now() + 10_000;
    while (Date.now() < fine) {
      const p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
      if (p) {
        await p.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
        return p;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('scheda non trovata: ' + url);
  };
  const pageA = await apri(urlA);
  const pageB = await apri(urlB);

  // A sta in secondo piano e chiede: nessuna domanda sopra la scheda B.
  await pageA.evaluate(() => window.__chiediFotocamera());
  await shell.waitForTimeout(2000);
  expect(await pastiglia(shell).count()).toBe(0);

  // B, la scheda che si sta guardando, chiede: la sua domanda compare.
  await pageB.evaluate(() => window.__chiediPosizione());
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(pastiglia(shell)).toContainText('dove sei');
});

test('prima di scegliere, al sito risulta "da chiedere" e non "negato" ────', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  // Molti siti guardano lo stato PRIMA di chiedere: se leggono "negato" non
  // chiedono mai, e il pulsante «attiva le notifiche» non fa niente. In Filo
  // quel sito non compare nemmeno nelle impostazioni, perché nessuna scelta è
  // stata presa: chi ci finisce resta senza via d'uscita.
  const page = await testServer.openReady(openTab, HTML);
  for (const n of ['camera', 'microphone', 'geolocation', 'notifications']) {
    expect(await page.evaluate((x) => window.__stato(x), n), `stato di ${n}`).toBe('prompt');
  }
  expect(await page.evaluate(() => Notification.permission)).toBe('default');

  // Un no detto davvero resta un no, subito, senza ricaricare la pagina.
  await page.evaluate(() => window.__chiediNotifiche());
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 10_000 });
  await shell.locator('.perm-chip .perm-chip-btn', { hasText: 'Nega' }).click();
  await expect(pastiglia(shell)).toHaveCount(0, { timeout: 8_000 });
  await expect.poll(() => page.evaluate(() => Notification.permission), { timeout: 8_000 }).toBe('denied');
});

test('in incognito la scelta si può anche togliere ────────────────────────', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  // Le scelte dell'incognito vivono in RAM e muoiono con la finestra, ma finché
  // la finestra è aperta si devono poter rivedere e togliere: se si può dare si
  // può togliere. Prima l'elenco leggeva solo il disco e tornava vuoto, quindi
  // l'unico modo di disdire era chiudere tutta la finestra.
  const url = testServer.html(HTML);
  await shell.evaluate(() => window.filoShell.openIncognito());
  let shellIncognito = null;
  const fine = Date.now() + 15_000;
  while (Date.now() < fine && !shellIncognito) {
    shellIncognito = app.windows().find((w) => {
      try { return w.url().includes('shell.html?incognito=1'); } catch (_) { return false; }
    }) || null;
    if (!shellIncognito) await new Promise((r) => setTimeout(r, 200));
  }
  expect(shellIncognito).toBeTruthy();
  // La cornice deve aver finito di montarsi: è lei che riceve la domanda.
  await shellIncognito.waitForLoadState('domcontentloaded').catch(() => {});
  await shellIncognito.waitForFunction(() => !!window.filoShell, null, { timeout: 8000 });
  await shellIncognito.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  const fine2 = Date.now() + 15_000;
  while (Date.now() < fine2 && !page) {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } }) || null;
    if (!page) await new Promise((r) => setTimeout(r, 200));
  }
  expect(page).toBeTruthy();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  await page.evaluate(() => window.__chiediFotocamera());
  await expect(shellIncognito.locator('.perm-chip')).toHaveCount(1, { timeout: 10_000 });
  await shellIncognito.locator('.perm-chip .perm-chip-allow').click();
  await expect.poll(() => page.evaluate(() => window.__stato('camera')), { timeout: 8000 }).toBe('granted');

  const origine = new URL(url).origin;
  const voci = await shellIncognito.evaluate((o) => window.filoShell.permissions.forOrigin(o), origine);
  expect((voci && voci.voci || []).length, 'la scelta dell\'incognito deve comparire fra quelle da togliere')
    .toBeGreaterThan(0);
  await shellIncognito.evaluate((o) => window.filoShell.permissions.revoke(o, null), origine);
  await expect.poll(() => page.evaluate(() => window.__stato('camera')), { timeout: 8000 }).toBe('prompt');

  // E su disco non è finito niente: l'incognito resta senza tracce.
  const suDisco = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  expect(suDisco[origine]).toBeUndefined();
});

// ─── la strada VECCHIA per prendersi lo schermo (giro di verifica 2) ────────
//
// Chromium consegna lo schermo a una pagina in due modi. Quello moderno,
// `getDisplayMedia()`, passa dal gestore della cattura schermo, dove Filo
// chiede e fa scegliere la fonte. Quello vecchio, `getUserMedia()` con
// `chromeMediaSource: 'desktop'` fra i vincoli, da quel gestore NON passa:
// appena il permesso è concesso consegna lo schermo intero, e il suono del
// computer se lo chiede.
//
// Le due richieste arrivano IDENTICHE: permesso «media» con la lista dei tipi
// vuota. Lasciarle passare per far arrivare la prima alla sua domanda apre
// anche la seconda, che domanda non ne incontra nessuna. Senza questa prova,
// una pagina qualunque si riprendeva schermo e audio senza un clic e senza
// che comparisse niente.

const HTML_SCHERMO = `<!doctype html><html><body style="margin:0">
<button id="share" style="padding:14px">condividi</button>
<script>
  const descrivi = (s) => s.getTracks().map((t) => ({ kind: t.kind, label: t.label }));
  const vecchia = (conAudio) => navigator.mediaDevices.getUserMedia({
    audio: conAudio ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
    video: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then((s) => { const d = descrivi(s); try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return d; },
          (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__schermoVecchiaManiera = () => vecchia(false);
  window.__schermoEAudioVecchiaManiera = () => vecchia(true);
  window.__r = null;
  document.getElementById('share').addEventListener('click', () => {
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(
      (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} window.__r = 'ok'; },
      (e) => { window.__r = 'no:' + ((e && e.name) || 'errore'); });
  });
</script></body></html>`;

// Una traccia vera dello schermo (o del suono del computer), non la webcam
// finta dei test (`fake_device_0`).
function traccia(esito, tipo) {
  if (!Array.isArray(esito)) return null;
  return esito.find((t) => t.kind === tipo && !/fake_device/i.test(String(t.label || ''))) || null;
}

test('anche la strada vecchia per lo schermo passa dalla domanda ──────────', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, HTML_SCHERMO);
  const origine = new URL(page.url()).origin;

  // Nessun clic: la pagina chiama e basta.
  const promessa = page.evaluate(() => window.__schermoVecchiaManiera());
  await expect(
    pastiglia(shell),
    'la pagina ha chiesto lo schermo alla vecchia maniera e non è comparsa nessuna domanda',
  ).toHaveCount(1, { timeout: 15_000 });
  await expect(pastiglia(shell)).toContainText('schermo');
  await expect(pastiglia(shell)).not.toContainText('fotocamera');

  // Chiuso senza decidere: alla pagina non arriva niente.
  await shell.locator('.perm-chip .perm-chip-x').first().click();
  expect(traccia(await promessa, 'video'), 'senza un sì non deve arrivare nessuna immagine dello schermo').toBeNull();
  await expect(pastiglia(shell)).toHaveCount(0, { timeout: 15_000 });

  // Nemmeno il suono del computer.
  const conAudio = page.evaluate(() => window.__schermoEAudioVecchiaManiera());
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 15_000 });
  await shell.locator('.perm-chip .perm-chip-x').first().click();
  const esito = await conAudio;
  expect(traccia(esito, 'video'), 'nessuna immagine dello schermo senza un sì').toBeNull();
  expect(traccia(esito, 'audio'), 'nessun audio del computer senza un sì').toBeNull();

  // Non è rimasto scritto niente: nessuno ha deciso.
  const ricordato = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  expect(ricordato[origine]).toBeUndefined();

  // Detto sì, lo schermo arriva: la difesa non spegne la funzione.
  await expect(pastiglia(shell)).toHaveCount(0, { timeout: 15_000 });
  const terza = page.evaluate(() => window.__schermoVecchiaManiera());
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 15_000 });
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  expect(traccia(await terza, 'video'), 'chi dice sì deve ottenere lo schermo').not.toBeNull();

  // E anche qui non resta scritto niente: lo schermo si richiede ogni volta.
  await page.waitForTimeout(800);
  const dopo = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  expect(dopo[origine], 'lo schermo non si ricorda mai').toBeUndefined();
});

test('la scelta di cosa condividere resta con la sua scheda ───────────────', async ({ app, shell, testServer }) => {
  test.setTimeout(120_000);
  const urlA = testServer.html(HTML_SCHERMO);
  const urlB = testServer.html(HTML_SCHERMO);
  const apri = async (u) => {
    await shell.evaluate((x) => window.filoShell.tabs.open(x), u);
    const fine = Date.now() + 12_000;
    while (Date.now() < fine) {
      const p = app.windows().find((w) => { try { return w.url() === u; } catch (_) { return false; } });
      if (p) {
        await p.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
        return p;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('scheda non trovata: ' + u);
  };
  const idDi = (u) => app.evaluate(({ BrowserWindow }, x) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) continue;
      const t = tm.tabs.find((y) => { try { return y.view.webContents.getURL() === x; } catch (_) { return false; } });
      if (t) return t.id;
    }
    return null;
  }, u);

  const a = await apri(urlA);
  await apri(urlB);
  const idA = await idDi(urlA);
  const idB = await idDi(urlB);
  const scelta = shell.locator('.perm-source');

  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idA);
  await a.click('#share');
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 15_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  await expect(scelta).toHaveCount(1, { timeout: 15_000 });

  // Le cose fra cui scegliere hanno un nome in italiano: dal sistema arrivano
  // «Entire screen», «Screen 1».
  for (const n of await scelta.locator('.perm-source-item').allTextContents()) {
    expect(n, `«${n}» è il nome che dà il sistema, in inglese`).not.toMatch(/Entire screen|Screen \d|Whole screen/i);
  }

  // Passando su un'altra scheda la scelta non resta lì sopra: col nome di un
  // sito che non è quello davanti agli occhi, un clic consegnerebbe lo schermo
  // a una pagina che non si sta nemmeno guardando.
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idB);
  await expect(scelta, 'la scelta è rimasta sopra un\'altra scheda').toHaveCount(0, { timeout: 10_000 });

  // E non è persa: tornando indietro è ancora lì da fare.
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idA);
  await expect(scelta).toHaveCount(1, { timeout: 10_000 });
  await scelta.locator('.perm-source-cancel').click();
  await expect.poll(() => a.evaluate(() => window.__r), { timeout: 15_000 }).not.toBe(null);
});

test('mentre un sito può vedere lo schermo, Filo lo dice e lo si interrompe ─', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, HTML_SCHERMO);
  const host = new URL(page.url()).host;
  const vivo = shell.locator('.perm-live');

  // Prima di scegliere la fonte il sito non vede ancora niente: nessun segno.
  await page.click('#share');
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 15_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  await expect(shell.locator('.perm-source')).toHaveCount(1, { timeout: 15_000 });
  await expect(vivo).toHaveCount(0);

  // Scelta la fonte, il segno compare: una webcam accesa si vede, uno schermo
  // ripreso non lascia nessun segno se non lo mette Filo.
  await shell.locator('.perm-source-item').first().click();
  await expect(vivo).toHaveCount(1, { timeout: 15_000 });
  await expect(vivo).toContainText(host);
  await expect(vivo).toContainText('schermo');

  // «Interrompi» chiude la ripresa: è l'unico modo di chiuderla per davvero.
  await vivo.locator('.perm-chip-btn').click();
  await expect(vivo).toHaveCount(0, { timeout: 15_000 });
});

test('in incognito le scelte si vedono e si tolgono anche dalle Impostazioni', async ({ app, shell, testServer }) => {
  test.setTimeout(120_000);
  // Le scelte dell'incognito vivono in RAM, non nelle impostazioni. La pagina
  // Sicurezza le leggeva dallo storage e lì non c'era niente: chi andava a
  // cercare la scelta appena fatta trovava un elenco che sembrava completo e
  // non lo era, e toglierla si poteva solo dal tasto destro sulla scheda.
  const url = testServer.html(HTML);
  await shell.evaluate(() => window.filoShell.openIncognito());
  let shellIncognito = null;
  const fine = Date.now() + 15_000;
  while (Date.now() < fine && !shellIncognito) {
    shellIncognito = app.windows().find((w) => {
      try { return w.url().includes('shell.html?incognito=1'); } catch (_) { return false; }
    }) || null;
    if (!shellIncognito) await new Promise((r) => setTimeout(r, 200));
  }
  expect(shellIncognito).toBeTruthy();
  await shellIncognito.waitForLoadState('domcontentloaded').catch(() => {});
  await shellIncognito.waitForFunction(() => !!window.filoShell, null, { timeout: 8000 });

  const apriDentro = async (u) => {
    await shellIncognito.evaluate((x) => window.filoShell.tabs.open(x), u);
    const scadenza = Date.now() + 15_000;
    while (Date.now() < scadenza) {
      const p = app.windows().find((w) => { try { return w.url().startsWith(u); } catch (_) { return false; } });
      if (p) { await p.waitForLoadState('domcontentloaded').catch(() => {}); return p; }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('scheda non trovata in incognito: ' + u);
  };

  const page = await apriDentro(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.evaluate(() => window.__chiediFotocamera());
  await expect(shellIncognito.locator('.perm-chip')).toHaveCount(1, { timeout: 10_000 });
  await shellIncognito.locator('.perm-chip .perm-chip-allow').click();
  await expect.poll(() => page.evaluate(() => window.__stato('camera')), { timeout: 8000 }).toBe('granted');

  const sicurezza = await apriDentro('filo://security/');
  await sicurezza.waitForSelector('#perms-list', { timeout: 8_000 });
  const riga = sicurezza.locator('#perms-list li').first();
  await expect(
    riga,
    'in incognito le Impostazioni non elencano la scelta appena fatta: un elenco che sembra completo e non lo è',
  ).toContainText(new URL(url).host, { timeout: 10_000 });
  await expect(riga).toContainText('Fotocamera');

  // E da qui si toglie: la × è la stessa invariante del tasto destro.
  await riga.locator('button').nth(1).click();
  await expect(sicurezza.locator('#perms-list li').first()).toContainText('Nessun sito', { timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => window.__stato('camera')), { timeout: 10_000 }).toBe('prompt');

  // E su disco non è finito niente: l'incognito resta senza tracce.
  const suDisco = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  expect(suDisco[new URL(url).origin]).toBeUndefined();
});

// ─── Le scorciatoie che saltano la domanda, e chi le può premere (#586) ──────
//
// Due voci del menu di Filo leggono gli appunti e accendono il microfono senza
// far comparire la pastiglia, perché lì a chiedere è l'utente a Filo e non il
// sito. Il menu però vive dentro la pagina del sito, e il codice del sito lo
// può aprire e premere da solo: un evento di tasto destro fabbricato e un
// `click()` su una voce. Così un sito qualunque si leggeva gli appunti (una
// password appena copiata) e accendeva il microfono senza che comparisse
// niente, e senza lasciare niente da revocare in Impostazioni.
//
// Qui si asserisce il successo dal punto di vista di chi naviga: gli appunti
// restano suoi e il microfono resta spento. Senza il guardiano dei gesti finti
// il primo assert è rosso, col segreto dentro il campo del sito.

const SEGRETO_APPUNTI = 'password-negli-appunti-7Q4';

const HTML_GESTI_FINTI = `<!doctype html><html><body style="margin:0;padding:20px">
<textarea id="ta" rows="4" cols="50"></textarea>
<script>
  const apriMenuDaSolo = async () => {
    const t = document.getElementById('ta');
    t.focus();
    t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 80 }));
    await new Promise((r) => setTimeout(r, 600));
  };
  window.__rubaAppunti = async () => {
    await apriMenuDaSolo();
    const incolla = document.querySelector('.sn-menu-paste-main');
    if (!incolla) return { trovata: false, testo: document.getElementById('ta').value };
    incolla.click();
    await new Promise((r) => setTimeout(r, 1500));
    return { trovata: true, testo: document.getElementById('ta').value };
  };
  window.__accendiMicrofono = async () => {
    await apriMenuDaSolo();
    const detta = [...document.querySelectorAll('button')].find((n) => /🎤/.test(n.textContent || ''));
    if (!detta) return { trovata: false };
    detta.click();
    await new Promise((r) => setTimeout(r, 2000));
    return { trovata: true };
  };
</script></body></html>`;

test('un sito non si legge gli appunti premendo da solo il menu di Filo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO_APPUNTI);
  const page = await testServer.openReady(openTab, HTML_GESTI_FINTI);

  const esito = await page.evaluate(() => window.__rubaAppunti());
  expect(esito.trovata, 'il menu di Filo non si è aperto: la prova non sta provando niente').toBe(true);
  expect(
    String(esito.testo || ''),
    'il sito si è preso gli appunti da solo, aprendo e premendo il menu di Filo, '
    + 'senza che comparisse nessuna domanda',
  ).not.toContain(SEGRETO_APPUNTI);
  expect(await pastiglia(shell).count()).toBe(0);
});

test('un sito non accende il microfono premendo da solo il menu di Filo', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, HTML_GESTI_FINTI);

  const esito = await page.evaluate(() => window.__accendiMicrofono());
  expect(esito.trovata, 'la voce della dettatura non si è trovata: la prova non sta provando niente').toBe(true);
  const spie = await page.evaluate(() => document.querySelectorAll('.sn-dictate-pill').length);
  expect(
    spie,
    'il sito ha fatto partire da solo la dettatura di Filo, cioè ha aperto il microfono, '
    + 'senza che comparisse nessuna domanda',
  ).toBe(0);
  expect(await pastiglia(shell).count()).toBe(0);
});

// Ma il menu, premuto da una persona, deve continuare a funzionare: il
// guardiano butta via i gesti finti, non l'Incolla di chi lo usa.
test('premuto da una persona, l\'Incolla del menu di Filo incolla ancora', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO_APPUNTI);
  const page = await testServer.openReady(openTab, HTML_GESTI_FINTI);

  await page.locator('#ta').click();
  await page.locator('#ta').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-main')).toBeVisible({ timeout: 10_000 });
  await page.locator('.sn-menu-paste-main').click();
  await expect
    .poll(() => page.evaluate(() => document.getElementById('ta').value), { timeout: 10_000 })
    .toContain(SEGRETO_APPUNTI);
});

// ─── L'audio del computer non viene dietro allo schermo di nascosto (#586) ───
//
// Un sito che chiede lo schermo può chiedere anche l'audio del computer: la
// musica, un video, la chiamata in un'altra finestra, la voce di chi ti parla.
// Arrivava insieme all'immagine senza che la domanda, il riquadro della scelta
// o il segno che resta lo nominassero, e senza un modo di dare l'una senza
// l'altro.

const HTML_SCHERMO_AUDIO = `<!doctype html><html><body style="margin:0"><p>prova</p>
<script>
  window.__schermoConAudio = () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(
    (s) => { const d = s.getTracks().map((t) => ({ kind: t.kind, label: t.label }));
             try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return d; },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
</script></body></html>`;

const audioDiSistema = (esito) => (Array.isArray(esito)
  ? esito.find((t) => t.kind === 'audio' && !/fake_device/i.test(String(t.label || ''))) || null
  : null);

test('lo schermo condiviso non porta con sé l\'audio del computer se non lo si accende', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, HTML_SCHERMO_AUDIO);

  const promessa = page.evaluate(() => window.__schermoConAudio());
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 15_000 });
  await pastiglia(shell).locator('.perm-chip-allow').click();

  const box = shell.locator('.perm-source');
  await expect(box).toHaveCount(1, { timeout: 15_000 });
  // La scelta dell'audio c'è, è nominata, ed è spenta: chi non la tocca dà solo
  // l'immagine.
  const scelta = box.locator('.perm-source-audio input');
  await expect(scelta, 'il sito ha chiesto l\'audio e niente lo nomina').toHaveCount(1);
  expect(await scelta.isChecked(), 'l\'audio del computer non può essere acceso di suo').toBe(false);
  await box.locator('.perm-source-item').first().click();

  const esito = await promessa;
  expect(
    audioDiSistema(esito),
    `senza accendere la scelta, al sito non deve arrivare l'audio del computer: ha ricevuto ${JSON.stringify(esito)}`,
  ).toBeNull();
  await expect(shell.locator('.perm-live')).toHaveCount(1, { timeout: 15_000 });
  await expect(shell.locator('.perm-live')).not.toContainText('audio');
});

test('acceso, l\'audio del computer arriva, e il segno della ripresa lo dice', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, HTML_SCHERMO_AUDIO);

  const promessa = page.evaluate(() => window.__schermoConAudio());
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 15_000 });
  await pastiglia(shell).locator('.perm-chip-allow').click();

  const box = shell.locator('.perm-source');
  await expect(box).toHaveCount(1, { timeout: 15_000 });
  await box.locator('.perm-source-audio input').check();
  await box.locator('.perm-source-item').first().click();

  expect(
    audioDiSistema(await promessa),
    'chi accende la scelta deve ottenere anche l\'audio del computer',
  ).not.toBeNull();
  await expect(shell.locator('.perm-live')).toContainText('audio del computer', { timeout: 15_000 });
});

// ─── Gli avvisi della scheda stanno in colonna, non uno sopra l'altro (#586) ──

const HTML_DUE_AVVISI = `<!doctype html><html><body style="margin:0"><p>pagina</p>
<script>
  window.__apri = () => { try { window.open('https://esempio.invalido/x', '_blank', 'width=420,height=320'); } catch (_) {} };
  window.__cam = () => navigator.mediaDevices.getUserMedia({ video: true }).catch(() => {});
</script></body></html>`;

test('la domanda di un permesso non copre l\'avviso della finestra bloccata', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, HTML_DUE_AVVISI);

  await page.evaluate(() => window.__apri());
  const avviso = shell.locator('.popup-chip');
  await expect(avviso).toHaveCount(1, { timeout: 15_000 });

  page.evaluate(() => window.__cam()).catch(() => {});
  await expect(pastiglia(shell)).toHaveCount(1, { timeout: 15_000 });
  await shell.waitForTimeout(300);

  const a = await avviso.first().boundingBox();
  const d = await pastiglia(shell).first().boundingBox();
  const sovrapposti = !!a && !!d
    && a.x < d.x + d.width && d.x < a.x + a.width
    && a.y < d.y + d.height && d.y < a.y + a.height;
  expect(
    sovrapposti,
    `i due avvisi della scheda si coprono: finestra bloccata a ${JSON.stringify(a)}, `
    + `domanda del permesso a ${JSON.stringify(d)}`,
  ).toBe(false);
  // E l'«Apri» dell'avviso coperto si deve poter premere.
  await expect(avviso.locator('button', { hasText: 'Apri' })).toBeVisible();
});

// ─── La richiesta impossibile non fa morire la scheda (#586) ─────────────────

test('una pagina che chiede l\'audio del computer senza l\'immagine non fa morire la scheda', async ({ openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
<p id="p">viva</p>
<script>
  window.__impossibile = () => navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then(() => 'concesso', (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
</script></body></html>`);

  const esito = await page.evaluate(() => window.__impossibile())
    .catch((e) => 'scheda morta: ' + e.message);
  expect(
    String(esito),
    'la scheda è morta per una riga di una pagina qualunque, invece di ricevere un errore',
  ).toContain('rifiutato');
  expect(
    await page.evaluate(() => document.getElementById('p').textContent).catch(() => '(morta)'),
    'la pagina deve essere ancora lì',
  ).toBe('viva');
});
