// Blocco apertura siti in blacklist (#170.3, #590) — e2e.
//
// Assertiamo il COMPORTAMENTO, non un messaggio:
//   1) cliccare un link verso un sito in blacklist (referrer NON di ricerca)
//      → la navigazione è bloccata (la tab NON cambia URL) e compare la
//        notifica "Sito bloccato" con l'azione "Apri comunque";
//   2) "Apri comunque" apre davvero il sito (bypassa il blocco);
//   3) #590 — la lista vale su TUTTE le strade: indirizzo scritto dall'utente
//      nella home, azione NAVIGA del modello, link. Prima valeva solo per le
//      ultime due (will-navigate / setWindowOpenHandler), quindi bastava che
//      una pagina ostile convincesse il modello a emettere NAVIGA — livello 1,
//      nessuna conferma — per aprire qualunque sito della lista.
//
// L'eccezione "referrer di motore di ricerca" (caso 2 della spec) è coperta in
// modo esaustivo dallo unit test tests/unit/siteBlock.test.mjs.
//
// Per rendere il blocco deterministico usiamo un DOMINIO REALE finto,
// "blocked.test" (estensione valida → entra davvero in blacklist, a differenza
// di un IP che l'app scarta di proposito). Il fixture Electron mappa
// "blocked.test" → 127.0.0.1 via --host-resolver-rules, così le pagine sono
// comunque servite dal testServer locale. Disattiviamo le liste pubbliche per
// non dipendere dalla rete.

import { test, expect } from './fixtures/electron.mjs';

// Host finto messo in blacklist. Deve combaciare con la regola host-resolver
// del fixture (MAP blocked.test 127.0.0.1).
const BLOCKED_HOST = 'blocked.test';

async function enableBlock(shell) {
  await shell.evaluate((host) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: [host] } } },
  }), BLOCKED_HOST);
  // lascia propagare configureFromSettings nel main
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
}

// URL servito dal testServer locale ma con hostname "blocked.test" (che il
// fixture risolve a 127.0.0.1): stesso contenuto, host in blacklist.
function blockedUrl(testServer, body) {
  return testServer.html(body).replace('127.0.0.1', BLOCKED_HOST);
}

test('blocco diretto: click su link verso sito in blacklist → bloccato + notifica', async ({ shell, openTab, testServer }) => {
  await enableBlock(shell);

  const targetUrl = blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1 id="t">TARGET BLOCCATO</h1>');
  const fromUrl = testServer.html(
    `<!doctype html><meta charset="utf-8"><a id="go" href="${targetUrl}">vai</a>`,
  );

  // La pagina di partenza viene aperta da Filo (programmatica) → consentita.
  const page = await openTab(fromUrl);
  await page.waitForSelector('#go', { timeout: 8000 });

  // Click sul link: è una navigazione top-level con referrer NON di ricerca.
  await page.evaluate(() => document.getElementById('go').click());

  // La notifica di blocco compare nella shell, con l'azione "Apri comunque".
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card).toBeVisible({ timeout: 6000 });
  await expect(card.locator('.shell-notif-action', { hasText: 'Apri comunque' })).toBeVisible();

  // La tab NON ha navigato: è rimasta sulla pagina di partenza (la navigazione
  // verso il sito in blacklist è stata annullata).
  await page.waitForTimeout(500);
  expect(page.url()).toBe(fromUrl);
});

test('"Apri comunque" apre il sito bypassando il blocco', async ({ app, shell, openTab, testServer }) => {
  await enableBlock(shell);

  const targetUrl = blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1 id="t">APERTO COMUNQUE</h1>');
  const fromUrl = testServer.html(
    `<!doctype html><meta charset="utf-8"><a id="go" href="${targetUrl}">vai</a>`,
  );

  const page = await openTab(fromUrl);
  await page.waitForSelector('#go', { timeout: 8000 });
  await page.evaluate(() => document.getElementById('go').click());

  const action = shell.locator('.shell-notif-action', { hasText: 'Apri comunque' });
  await expect(action).toBeVisible({ timeout: 6000 });
  await action.click();

  // Il sito si apre davvero: compare un WebContentsView che mostra il target.
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try {
        const has = await w.evaluate(() => !!document.getElementById('t') && document.getElementById('t').textContent.includes('APERTO COMUNQUE'));
        if (has) return true;
      } catch (_) {}
    }
    return false;
  }, { timeout: 8000 }).toBe(true);
});

test('Sicurezza: il toggle e la blacklist dedicata persistono', async ({ openTab }) => {
  const page = await openTab('filo://security/security.html');
  await page.waitForSelector('#sec-siteblock', { timeout: 8000 });

  // I controlli esistono.
  await expect(page.locator('#sec-siteblock')).toHaveCount(1);
  await expect(page.locator('#sec-siteblock-lists')).toHaveCount(1);
  await expect(page.locator('#sec-siteblock-blacklist')).toHaveCount(1);

  // Aggiunge un dominio alla blacklist dedicata e salva (change).
  await page.locator('#sec-siteblock-blacklist').fill('cattivo.example\naltro.test');
  await page.locator('#sec-siteblock-blacklist').dispatchEvent('change');

  await expect
    .poll(() => page.evaluate(async () => {
      const sb = (await window.SN_STORAGE.getSettings()).security?.siteBlock || {};
      return sb.blacklist || [];
    }), { timeout: 4000 })
    .toEqual(['cattivo.example', 'altro.test']);

  // Sopravvive a una ricarica della pagina.
  await page.reload();
  await page.waitForSelector('#sec-siteblock-blacklist', { timeout: 8000 });
  await expect(page.locator('#sec-siteblock-blacklist')).toHaveValue('cattivo.example\naltro.test');
});

test('#590 apertura PROGRAMMATICA (lo stesso percorso di NAVIGA) verso un sito in blacklist → bloccata', async ({ app, shell, testServer }) => {
  await enableBlock(shell);

  const targetUrl = blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1 id="t">NON DEVE APRIRSI</h1>');

  // window.filoShell.tabs.open → openTab del main: lo stesso percorso
  // dell'azione NAVIGA e dell'indirizzo scritto nella home. Prima di #590 qui
  // non c'era nessun controllo e la scheda si apriva.
  await shell.evaluate((u) => window.filoShell.tabs.open(u), targetUrl);

  // Compare la notifica di blocco, con lo scavalco esplicito.
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card).toBeVisible({ timeout: 6000 });
  await expect(card.locator('.shell-notif-action', { hasText: 'Apri comunque' })).toBeVisible();

  // E nessuna scheda è nata su quell'host.
  await shell.waitForTimeout(800);
  expect(schedeSuHost(app, BLOCKED_HOST)).toBe(0);
});

// ─── #590: la lista vale su TUTTE le strade ──────────────────────────────────
//
// Host della lista per questo blocco: un nome di RETE LOCALE (.lan). Il campo
// della home, prima di navigare, chiede al sistema se l'host esiste (#433) e i
// nomi di rete locale sono esentati da quel controllo — così lo spec non
// dipende dal DNS della macchina che lo lancia (su "blocco.test" la risposta
// cambia da un contenitore all'altro). Bloccato, la scheda non nasce comunque:
// nessuna richiesta parte davvero.
const HOST_LAN = 'bloccato.lan';
const URL_LAN = `http://${HOST_LAN}/pagina`;

function schedeSuHost(app, host) {
  return app.windows().filter((w) => {
    try { return new URL(w.url()).hostname === host; } catch (_) { return false; }
  }).length;
}

async function abilitaBloccoLan(shell) {
  await shell.evaluate((host) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: [host] } } },
  }), HOST_LAN);
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
}

test('#590 strada 1 — indirizzo scritto dall’utente nella home → bloccato', async ({ app, shell, openTab }) => {
  await abilitaBloccoLan(shell);

  const dash = await openTab('filo://newtab/');
  const input = dash.locator('#input');
  await input.waitFor({ state: 'visible', timeout: 8000 });
  await input.fill(`/${HOST_LAN}`);
  await input.press('Enter');

  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card).toBeVisible({ timeout: 8000 });
  await expect(card.locator('.shell-notif-action', { hasText: 'Apri comunque' })).toBeVisible();

  // Nessuna scheda su quell'host: prima di #590 ne nasceva una.
  await dash.waitForTimeout(800);
  expect(schedeSuHost(app, HOST_LAN)).toBe(0);
});

test('#590 strada 2 — azione NAVIGA del modello → bloccata, e la chat lo dice', async ({ app, shell }) => {
  await abilitaBloccoLan(shell);

  // Lo stesso ingresso che usa il modello quando emette NAVIGA (livello 1,
  // nessuna conferma): è il caso della segnalazione — una pagina ostile che
  // convince il modello ad aprire un indirizzo della lista.
  const esito = await app.evaluate((_electron, url) =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url }), URL_LAN);

  // L'azione NON è stata eseguita, e l'esito PORTA il motivo: la chat mostra
  // "Link non aperto · sito bloccato: …" invece di tacere (#482).
  expect(esito.executed).toBe(false);
  expect(esito.output && esito.output.blocked).toBe('site');
  expect(esito.output && esito.output.host).toBe(HOST_LAN);

  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card).toBeVisible({ timeout: 6000 });

  await shell.waitForTimeout(800);
  expect(schedeSuHost(app, HOST_LAN)).toBe(0);
});

test('#590 strada 3 — link cliccato in una pagina → bloccato', async ({ app, shell, openTab, testServer }) => {
  await abilitaBloccoLan(shell);

  const fromUrl = testServer.html(
    `<!doctype html><meta charset="utf-8"><a id="go" href="${URL_LAN}">vai</a>`,
  );
  const page = await openTab(fromUrl);
  await page.waitForSelector('#go', { timeout: 8000 });
  await page.evaluate(() => document.getElementById('go').click());

  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card).toBeVisible({ timeout: 6000 });

  // La scheda è rimasta dov'era e nessuna è nata sull'host bloccato.
  await page.waitForTimeout(500);
  expect(page.url()).toBe(fromUrl);
  expect(schedeSuHost(app, HOST_LAN)).toBe(0);
});

// ─── #590 giro 2: lo STESSO sito per una strada diversa ──────────────────────
//
// Il punto di passaggio unico c'era, ma la decisione che prendeva si scavalcava
// in due modi, e valevano su tutte le strade insieme:
//   • un PUNTO in fondo al nome del sito ("bloccato.lan." è la forma assoluta
//     di "bloccato.lan": la rete apre la stessa pagina, il confronto con la
//     lista no);
//   • un RIMBALZO del server (301/302): il controllo guardava l'indirizzo
//     chiesto, non quello dove si finiva davvero.

test('#590 il punto finale nel nome del sito non scavalca la lista (NAVIGA del modello)', async ({ app, shell }) => {
  await abilitaBloccoLan(shell);

  const esito = await app.evaluate((_electron, url) =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url }), `http://${HOST_LAN}./pagina`);

  expect(esito.executed).toBe(false);
  expect(esito.output && esito.output.blocked).toBe('site');
  expect(esito.output && esito.output.host).toBe(HOST_LAN);
  await shell.waitForTimeout(500);
  expect(schedeSuHost(app, `${HOST_LAN}.`)).toBe(0);
});

test('#590 il punto finale non scavalca la lista sulla barra degli indirizzi', async ({ shell, openTab }) => {
  await enableBlock(shell); // blocked.test, che il fixture risolve davvero

  await openTab('filo://newtab/');
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const id = snap.tabs[snap.tabs.length - 1].id;
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, `http://${BLOCKED_HOST}./`]);
  await shell.waitForTimeout(1200);

  const dopo = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const suHost = dopo.tabs.filter((t) => {
    try { return new URL(t.url).hostname.replace(/\.$/, '') === BLOCKED_HOST; } catch (_) { return false; }
  }).length;
  expect(suHost).toBe(0);
});

test('#590 un RIMBALZO del server verso un sito della lista è bloccato', async ({ shell, openTab }) => {
  await enableBlock(shell);

  // Server con un rimbalzo vero: /partenza ha il link, /rimbalzo risponde 302
  // verso l'host in lista, /arrivo è la pagina che non deve comparire.
  const { createServer } = await import('node:http');
  let porta = 0;
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/rimbalzo') {
      res.writeHead(302, { Location: `http://${BLOCKED_HOST}:${porta}/arrivo` });
      res.end();
      return;
    }
    if (path === '/arrivo') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><h1 id="t">NON DEVE ARRIVARE</h1>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><a id="go" href="http://127.0.0.1:${porta}/rimbalzo">vai</a>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  porta = server.address().port;

  try {
    const partenza = `http://127.0.0.1:${porta}/partenza`;
    const page = await openTab(partenza);
    await page.waitForSelector('#go', { timeout: 8000 });
    await page.evaluate(() => document.getElementById('go').click());

    // La notifica arriva (il blocco non è muto) e la pagina non compare.
    const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
    await expect(card).toBeVisible({ timeout: 6000 });
    await page.waitForTimeout(800);
    const arrivato = await page.evaluate(() => !!document.getElementById('t')).catch(() => false);
    expect(arrivato).toBe(false);

    const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
    const suHost = snap.tabs.filter((t) => {
      try { return new URL(t.url).hostname === BLOCKED_HOST; } catch (_) { return false; }
    }).length;
    expect(suHost).toBe(0);
  } finally {
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
});

test('#590 un indirizzo senza schema apre la pagina giusta invece di una scheda bianca', async ({ app, shell, testServer }) => {
  await abilitaBloccoLan(shell);

  // Il modello propone l'indirizzo senza "http://" davanti (capita coi modelli
  // piccoli): prima nasceva una scheda bianca e la chat raccontava di averla
  // aperta. Ora l'indirizzo viene completato e la pagina si carica davvero.
  const nudo = testServer.html('<!doctype html><meta charset="utf-8"><h1 id="t">PAGINA VERA</h1>')
    .replace(/^https?:\/\//, '');
  const esito = await app.evaluate((_electron, url) =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url }), nudo);
  expect(esito.executed).toBe(true);

  await expect.poll(async () => {
    for (const w of app.windows()) {
      try {
        if (await w.evaluate(() => document.getElementById('t')?.textContent === 'PAGINA VERA')) return true;
      } catch (_) {}
    }
    return false;
  }, { timeout: 8000 }).toBe(true);

  // E quando non è un indirizzo, la chat NON racconta di aver aperto niente.
  const vuoto = await app.evaluate(() =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: 'ciao come stai' }));
  expect(vuoto.executed).toBe(false);
  expect(vuoto.output && vuoto.output.blocked).toBe('address');
});

test('#590 anche la finestrella di accesso applica la lista dei siti bloccati', async ({ app, shell, openTab, testServer }) => {
  await enableBlock(shell);

  const target = blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1 id="t">NON DEVE ARRIVARE</h1>');
  // Pagina servita dentro il popup di accesso: i parametri OAuth in query sono
  // ciò che fa riconoscere la finestra come popup di login (e quindi la fa
  // nascere come VERA finestra, fuori dal giro delle schede — era l'unica
  // superficie rimasta senza il controllo della lista).
  const login = `${testServer.html(`<!doctype html><meta charset="utf-8"><a id="go" href="${target}">continua</a>`)}?client_id=x&redirect_uri=https%3A%2F%2Fesempio.test%2Fcb`;
  const apri = testServer.html(
    `<!doctype html><meta charset="utf-8"><button id="b" onclick="window.open('${login}','_blank','width=520,height=640')">accedi</button>`,
  );

  const page = await openTab(apri);
  await page.click('#b');

  // La finestrella si apre e mostra il link.
  const popup = await expect.poll(async () => {
    for (const w of app.windows()) {
      try { if (await w.evaluate(() => !!document.getElementById('go'))) return w; } catch (_) {}
    }
    return null;
  }, { timeout: 8000 }).not.toBeNull().then(async () => {
    for (const w of app.windows()) {
      try { if (await w.evaluate(() => !!document.getElementById('go'))) return w; } catch (_) {}
    }
    return null;
  });

  await popup.evaluate(() => document.getElementById('go').click());
  await popup.waitForTimeout(1200);

  // Il sito della lista non è arrivato: la finestrella è rimasta dov'era.
  expect(await popup.evaluate(() => !!document.getElementById('t')).catch(() => false)).toBe(false);
  expect(new URL(popup.url()).hostname).not.toBe(BLOCKED_HOST);
});

// ─── #590 giro 2 — il sì dell'utente vale oltre la prima richiesta ───────────

// Sito della lista che si comporta come quasi ogni sito vero: la pagina chiesta
// risponde "vai qui" (il salto da http a https, la barra iniziale che porta
// alla home) invece di dare subito il contenuto.
async function sitoCheRimbalza() {
  const { createServer } = await import('node:http');
  let porta = 0;
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/rimbalza') {
      res.writeHead(302, { Location: `http://${BLOCKED_HOST}:${porta}/dentro` });
      res.end();
      return;
    }
    const corpo = path === '/dentro'
      ? '<h1 id="dentro">SONO DENTRO</h1>'
      : `<h1 id="ingresso">INGRESSO</h1><a id="go" href="http://${BLOCKED_HOST}:${porta}/dentro">avanti</a>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8">${corpo}`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  porta = server.address().port;
  return {
    porta,
    chiudi: async () => {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

async function apriComunque(shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const azione = shell.locator('.shell-notif-action', { hasText: 'Apri comunque' });
  await expect(azione).toBeVisible({ timeout: 6000 });
  await azione.click();
}

// La Page che contiene quell'elemento, fra i WebContentsView aperti.
async function paginaCon(app, id) {
  const fine = Date.now() + 10000;
  while (Date.now() < fine) {
    for (const w of app.windows()) {
      try { if (await w.evaluate((s) => !!document.getElementById(s), id)) return w; } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

test('#590 "Apri comunque" apre anche un sito che rimbalza (e rimbalza quasi tutto)', async ({ app, shell }) => {
  await enableBlock(shell);
  const s = await sitoCheRimbalza();
  try {
    // Senza il sì registrato, il rimbalzo trovava un controllo che del sì non
    // sapeva niente: la scheda restava vuota e il sito non si apriva più.
    await apriComunque(shell, `http://${BLOCKED_HOST}:${s.porta}/rimbalza`);
    expect(await paginaCon(app, 'dentro'), 'il sito deve aprirsi davvero').not.toBeNull();
  } finally {
    await s.chiudi();
  }
});

test('#590 dopo "Apri comunque" si naviga dentro il sito: link, ricarica, scheda nuova', async ({ app, shell }) => {
  await enableBlock(shell);
  const s = await sitoCheRimbalza();
  try {
    await apriComunque(shell, `http://${BLOCKED_HOST}:${s.porta}/ingresso`);
    const page = await paginaCon(app, 'ingresso');
    expect(page).not.toBeNull();

    // Un link interno al sito.
    await page.evaluate(() => document.getElementById('go').click());
    await expect(page.locator('#dentro')).toBeVisible({ timeout: 8000 });

    // Ricaricare.
    await page.evaluate(() => window.location.reload());
    await expect(page.locator('#dentro')).toBeVisible({ timeout: 8000 });

    // Un link che apre una scheda nuova dentro lo stesso sito.
    await page.evaluate((p) => window.open(`http://blocked.test:${p}/ingresso`, '_blank'), s.porta);
    expect(await paginaCon(app, 'ingresso'), 'la scheda nuova deve nascere').not.toBeNull();
  } finally {
    await s.chiudi();
  }
});

test('#590 un rimbalzo fermato non lascia una scheda vuota da chiudere a mano', async ({ shell }) => {
  await enableBlock(shell);
  const s = await sitoCheRimbalza();
  try {
    // Filo apre un indirizzo innocuo (un accorciatore) che rimbalza sul sito
    // della lista: il blocco è giusto, ma la scheda era già nata.
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://127.0.0.1:${s.porta}/rimbalza`);
    const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
    await expect(card).toBeVisible({ timeout: 6000 });
    await expect.poll(async () => {
      const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
      return snap.tabs.filter((t) => !t.url).length;
    }, { timeout: 6000 }).toBe(0);
  } finally {
    await s.chiudi();
  }
});
