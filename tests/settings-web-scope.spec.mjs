// #589 — le impostazioni spinte alle schede non portano segreti nelle pagine web.
//
// Quando si salva una preferenza, Filo spinge le impostazioni a tutte le
// superfici aperte. I content script girano anche sui siti esterni, quindi
// quella spinta arriva a ogni pagina visitata: dentro le impostazioni ci sono
// le chiavi dei servizi a pagamento e le credenziali del proxy (utente e
// password nell'URL).
//
// Qui si guarda il messaggio DAVVERO consegnato a ciascun frame, all'ultimo
// passaggio prima del renderer, e si pretende:
//   - alla pagina del mini server (https/http): nessun segreto, e solo i campi
//     ammessi (src/shared/settingsScope.js);
//   - alla pagina filo://: l'oggetto intero, chiavi comprese;
//   - e che la spinta continui a FUNZIONARE sulla pagina esterna (il token
//     estetico cambia live), altrimenti la difesa avrebbe spento una funzione.
//
// Senza il fix il primo controllo è rosso: la spinta mandava l'oggetto intero
// a tutti.

import { test, expect } from './fixtures/electron.mjs';

const CHIAVE = 'sk-or-v1-SENTINELLA-589-CHIAVE';
const PROXY_URL = 'socks5://utente-it:SENTINELLA-589-PASSWORD@gate.example.com:7000';

// Spia sull'ultimo passaggio main→renderer: registra ogni broadcast con
// l'indirizzo del frame che lo riceve. Copre sia l'invio per-frame sia il
// ripiego su webContents.send.
async function installaSpia(app) {
  await app.evaluate(({ BrowserWindow }) => {
    if (globalThis.__spia589) return;
    globalThis.__spia589 = [];
    const registra = (url, message) => {
      try {
        if (message && message.type === 'settings_updated') {
          globalThis.__spia589.push({ url: String(url || ''), settings: message.settings });
        }
      } catch (_) {}
    };
    const win = BrowserWindow.getAllWindows()[0];
    const wcProto = Object.getPrototypeOf(win.webContents);
    const origWcSend = wcProto.send;
    wcProto.send = function (channel, ...args) {
      if (channel === 'filo:broadcast') { let u = ''; try { u = this.getURL(); } catch (_) {} registra(u, args[0]); }
      return origWcSend.call(this, channel, ...args);
    };
    const frame = win.webContents.mainFrame;
    if (frame) {
      const frProto = Object.getPrototypeOf(frame);
      const origFrSend = frProto.send;
      frProto.send = function (channel, ...args) {
        if (channel === 'filo:broadcast') { let u = ''; try { u = this.url; } catch (_) {} registra(u, args[0]); }
        return origFrSend.call(this, channel, ...args);
      };
    }
  });
}

const leggiSpia = (app) => app.evaluate(() => globalThis.__spia589 || []);

const cssVar = (page, name) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('la spinta delle impostazioni non porta chiavi API né credenziali proxy nelle pagine web', async ({ app, shell, openTab, testServer }) => {
  // L'utente ha configurato chiave e proxy dalle Preferenze (origine filo://).
  await shell.evaluate(([chiave, proxy]) => window.filoShell.message({
    type: 'update_settings',
    settings: { apiKeys: { openrouter: chiave }, proxy: { datacenter: proxy, residential: proxy } },
  }), [CHIAVE, PROXY_URL]);

  // Una pagina esterna aperta (il content script di Filo ci gira sopra) e una
  // pagina interna: la stessa spinta deve trattarle in modo diverso.
  const web = await testServer.openReady(openTab, '<h1>pagina esterna</h1><p>testo</p>');
  const interna = await openTab('filo://preferences/preferences.html');

  await installaSpia(app);

  // Ora si cambia una preferenza qualunque: parte la spinta a tutti.
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { themeTokens: { accent: '#1e90ff' } },
  }));

  // La spinta FUNZIONA ancora sulla pagina esterna: il token arriva e si applica.
  await expect.poll(() => cssVar(web, '--sn-accent')).toBe('#1e90ff');

  const consegne = await leggiSpia(app);
  expect(consegne.length, 'nessuna consegna di settings_updated registrata').toBeGreaterThan(0);

  const versoWeb = consegne.filter((c) => /^https?:/.test(c.url));
  expect(versoWeb.length, 'la pagina esterna non ha ricevuto la spinta').toBeGreaterThan(0);
  for (const c of versoWeb) {
    const dump = JSON.stringify(c.settings ?? null);
    expect(dump, `chiave API consegnata a ${c.url}`).not.toContain(CHIAVE);
    expect(dump, `password del proxy consegnata a ${c.url}`).not.toContain('SENTINELLA-589-PASSWORD');
    expect(c.settings?.apiKeys, `apiKeys consegnate a ${c.url}`).toBeUndefined();
    expect(c.settings?.proxy, `proxy consegnato a ${c.url}`).toBeUndefined();
    // ...ma ciò che serve al content script c'è.
    expect(c.settings?.themeTokens).toEqual({ accent: '#1e90ff' });
    expect(c.settings?.featureFlags, 'i flag delle funzioni servono al content script').toBeTruthy();
  }

  const versoInterna = consegne.filter((c) => c.url.startsWith('filo://'));
  expect(versoInterna.length, 'le superfici interne non hanno ricevuto la spinta').toBeGreaterThan(0);
  expect(
    versoInterna.some((c) => c.settings?.apiKeys?.openrouter === CHIAVE),
    'le pagine filo:// devono continuare a ricevere le impostazioni intere',
  ).toBe(true);

  // La pagina interna resta funzionante (la preferenza è arrivata anche lì).
  await expect.poll(() => cssVar(interna, '--sn-accent')).toBe('#1e90ff');
});

test('anche la lettura a richiesta da una pagina web è ridotta ai campi ammessi', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(([chiave, proxy]) => window.filoShell.message({
    type: 'update_settings',
    settings: { apiKeys: { openrouter: chiave }, proxy: { datacenter: proxy } },
  }), [CHIAVE, PROXY_URL]);

  const web = await testServer.openReady(openTab, '<h1>pagina esterna</h1>');
  const url = web.url();

  // GET_SETTINGS chiesto con l'origine della pagina esterna: è la strada che
  // percorre il content script al suo avvio.
  const risposta = await app.evaluate(async ({}, pageUrl) => {
    const H = globalThis.__filoHandlers;
    return H.handleMessage({ type: 'get_settings' }, { url: pageUrl });
  }, url);

  const dump = JSON.stringify(risposta?.settings ?? null);
  expect(dump).not.toContain(CHIAVE);
  expect(dump).not.toContain('SENTINELLA-589-PASSWORD');
  expect(risposta?.settings?.theme, 'il tema serve al content script').toBeTruthy();

  // La stessa richiesta da una pagina interna riceve tutto.
  const rispostaInterna = await app.evaluate(async () => {
    const H = globalThis.__filoHandlers;
    return H.handleMessage({ type: 'get_settings' }, { url: 'filo://newtab/' });
  });
  expect(rispostaInterna?.settings?.apiKeys?.openrouter).toBe(CHIAVE);
});

test('da una pagina web non si può chiedere TUTTO lo storage in un colpo solo', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate((chiave) => window.filoShell.message({
    type: 'update_settings',
    settings: { apiKeys: { openrouter: chiave } },
  }), CHIAVE);

  const web = await testServer.openReady(openTab, '<h1>pagina esterna</h1>');
  const url = web.url();

  // Senza chiavi = "dammi tutto": cronologia AI, memoria, pagine salvate, costi.
  const tutto = await app.evaluate(async ({}, pageUrl) => {
    const H = globalThis.__filoHandlers;
    return H.handleMessage({ type: '_storage:get', keys: null }, { url: pageUrl });
  }, url);
  expect(tutto?.ok, 'una pagina web non deve poter svuotare lo storage in lettura').toBe(false);
  expect(tutto?.value).toBeUndefined();

  // Quello che i content script fanno davvero — chiedere le loro chiavi per
  // nome — continua a funzionare.
  const perNome = await app.evaluate(async ({}, pageUrl) => {
    const H = globalThis.__filoHandlers;
    return H.handleMessage({ type: '_storage:get', keys: ['settings'] }, { url: pageUrl });
  }, url);
  expect(perNome?.ok).toBe(true);
  expect(perNome?.value?.settings?.theme, 'il tema arriva comunque al content script').toBeTruthy();
  expect(JSON.stringify(perNome?.value ?? null)).not.toContain(CHIAVE);

  // E dalle pagine interne la lettura completa resta possibile (Opzioni, export).
  const interna = await app.evaluate(async () => {
    const H = globalThis.__filoHandlers;
    return H.handleMessage({ type: '_storage:get', keys: null }, { url: 'filo://options/options.html' });
  });
  expect(interna?.ok).toBe(true);
  expect(interna?.value?.settings).toBeTruthy();
});

// ── La stessa strada, l'altro carico (#589, giro 1 di verifica) ─────────────
// Le impostazioni non sono l'unica cosa che Filo spinge a tutte le schede: sulla
// stessa strada viaggia il cambio di stato dell'account, che porta il profilo
// Google dell'utente (email, nome, foto) e il contrassegno di amministratore.
// Dentro i siti non lo usa nessuno. Senza il fix il primo controllo è rosso:
// quel messaggio arrivava anche alle pagine dei siti aperti.

async function spiaBroadcast(app) {
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__spiaTutti589 = [];
    const nota = (url, m) => {
      if (m && m.type) globalThis.__spiaTutti589.push({ url: String(url || ''), tipo: m.type });
    };
    const win = BrowserWindow.getAllWindows()[0];
    if (!globalThis.__spiaTutti589Fr) {
      globalThis.__spiaTutti589Fr = true;
      const fr = win.webContents.mainFrame;
      const frProto = Object.getPrototypeOf(fr);
      const orig = frProto.send;
      frProto.send = function (ch, ...a) {
        if (ch === 'filo:broadcast') { let u = ''; try { u = this.url; } catch (_) {} nota(u, a[0]); }
        return orig.call(this, ch, ...a);
      };
    }
    if (!globalThis.__spiaTutti589Wc) {
      globalThis.__spiaTutti589Wc = true;
      const wcProto = Object.getPrototypeOf(win.webContents);
      const orig = wcProto.send;
      wcProto.send = function (ch, ...a) {
        if (ch === 'filo:broadcast') { let u = ''; try { u = this.getURL(); } catch (_) {} nota(u, a[0]); }
        return orig.call(this, ch, ...a);
      };
    }
  });
}

test('il cambio di stato dell\'account non viene spinto nelle pagine dei siti', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const interna = await openTab('filo://newtab/');
  await spiaBroadcast(app);

  await shell.evaluate(() => window.filoShell.message({ type: 'auth_signout' }));

  const tutti = await app.evaluate(() => globalThis.__spiaTutti589 || []);
  const cambiStato = tutti.filter((c) => c.tipo === 'auth_changed');
  expect(cambiStato.length, 'il cambio di stato non è partito affatto').toBeGreaterThan(0);
  expect(
    cambiStato.filter((c) => /^https?:/.test(c.url)).map((c) => c.url),
    'lo stato dell\'account è stato spinto anche nelle pagine dei siti aperti',
  ).toEqual([]);
  // Ma le superfici di Filo lo ricevono: è lì che serve.
  expect(cambiStato.some((c) => c.url.startsWith('filo://') || c.url === ''),
    'le pagine di Filo devono continuare a sapere che l\'account è cambiato').toBe(true);
  expect(interna).toBeTruthy();
});

test('un sito che chiede lo stato dell\'account sa solo se c\'è un accesso', async ({ app, openTab, testServer }) => {
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  const url = web.url();

  const dalSito = await app.evaluate(async ({}, u) => {
    const H = globalThis.__filoHandlers;
    return H.handleMessage({ type: 'auth_status' }, { url: u, tab: { url: u } });
  }, url);
  // Quello che il modulo del red team usa davvero, dentro una pagina: c'è.
  expect(typeof dalSito?.signedIn, 'al sito serve sapere se c\'è un accesso').toBe('boolean');
  // Identità e poteri dell'utente: no.
  expect(Object.keys(dalSito).sort()).toEqual(['ok', 'signedIn']);

  // Dalle pagine di Filo la risposta resta intera (la bacheca riconosce i voti).
  const daFilo = await app.evaluate(async () => {
    const H = globalThis.__filoHandlers;
    return H.handleMessage({ type: 'auth_status' }, { url: 'filo://board/board.html' });
  });
  expect(Object.keys(daFilo).sort()).toEqual(['isAdmin', 'ok', 'profile', 'signedIn', 'uid']);
});

// ── Non tutte le finestre sono superfici di Filo ────────────────────────────
// I popup di accesso («Continua con Google» e simili) sono finestre vere con
// dentro la pagina di un sito, e ci gira il codice di Filo come su ogni altra
// pagina. La spinta delle impostazioni sceglieva per riquadro nelle schede ma
// mandava l'oggetto intero alla finestra, dando per scontato che ogni finestra
// fosse la shell: bastava avere un accesso aperto mentre si salva una
// preferenza perché in quella pagina finissero chiave e password del proxy.
test('un popup di accesso aperto da un sito non riceve chiavi né credenziali del proxy', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate((s) => window.filoShell.message({ type: 'update_settings', settings: s }), {
    apiKeys: { openrouter: CHIAVE },
    proxy: { datacenter: PROXY_URL },
  });

  const web = await testServer.openReady(openTab, '<h1>sito con accesso</h1>');
  const login = `${testServer.html('<h1>accedi</h1>')}?client_id=abc&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await web.evaluate((u) => window.open(u, '_blank'), login);

  await expect.poll(
    () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => {
      try { return w.webContents.getURL(); } catch (_) { return ''; }
    })),
    { timeout: 8000 },
  ).toContain(login);

  await installaSpia(app);
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await expect.poll(async () => (await leggiSpia(app)).length, { timeout: 8000 }).toBeGreaterThan(0);

  const versoIlSito = (await leggiSpia(app)).filter((c) => /^https?:/.test(c.url));
  expect(versoIlSito.length, 'al popup non è arrivato niente: la prova non guarda dove deve').toBeGreaterThan(0);
  for (const c of versoIlSito) {
    const dump = JSON.stringify(c.settings ?? null);
    expect(dump, `chiave consegnata a ${c.url}`).not.toContain(CHIAVE);
    expect(dump, `password del proxy consegnata a ${c.url}`).not.toContain('SENTINELLA-589-PASSWORD');
  }
  // E la preferenza cambiata vale lo stesso, anche lì dentro.
  expect(versoIlSito.some((c) => c.settings && c.settings.theme === 'dark'),
    'il tema nuovo deve arrivare comunque alle pagine dei siti').toBe(true);
});

// ── Quello che un sito può CHIEDERE ────────────────────────────────────────
// Stessa regola della spinta, dal verso opposto: verso una pagina di un sito
// passa solo quello che il codice dentro le pagine usa davvero
// (src/shared/webMessageScope.js). Prima rispondevano anche le domande che
// consegnano i dati personali dell'utente.
test('un sito non ottiene memoria, pagine salvate e stato, e non può far uscire dall\'account', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(async () => {
    const m = (x) => window.filoShell.message(x);
    await m({ type: '_storage:set', obj: { filo_memory: { PROFILO: 'Vive a MILANO-SENTINELLA-589', PREFERENZE: '' } } });
    await m({ type: 'save_page', page: { url: 'https://banca.example/conto', title: 'CONTO-SENTINELLA-589', text: 'saldo' } });
  });
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  const url = web.url();

  const risposte = await app.evaluate(async ({}, u) => {
    const H = globalThis.__filoHandlers;
    const chiedi = (msg) => H.handleMessage(msg, { url: u, tab: { url: u } }).catch((e) => ({ errore: String(e) }));
    return {
      memoria: await chiedi({ type: 'filo_get_memory' }),
      salvate: await chiedi({ type: 'get_saved_pages' }),
      stato: await chiedi({ type: 'filo_get_state' }),
      archiviate: await chiedi({ type: 'get_archived_tabs' }),
      uscita: await chiedi({ type: 'auth_signout' }),
      // Quello che il codice dentro le pagine usa davvero deve continuare a funzionare.
      impostazioni: await chiedi({ type: 'get_settings' }),
      appunti: await chiedi({ type: 'get_clipboard_history' }),
    };
  }, url);

  for (const nome of ['memoria', 'salvate', 'stato', 'archiviate', 'uscita']) {
    expect(risposte[nome]?.ok, `un sito ha ottenuto risposta a "${nome}"`).not.toBe(true);
  }
  const tutto = JSON.stringify(risposte);
  expect(tutto, 'la memoria di Filo sull\'utente è uscita verso il sito').not.toContain('MILANO-SENTINELLA-589');
  expect(tutto, 'le pagine salvate dall\'utente sono uscite verso il sito').not.toContain('CONTO-SENTINELLA-589');

  expect(risposte.impostazioni?.ok, 'il content script deve continuare a leggere le impostazioni').toBe(true);
  expect(risposte.appunti?.ok, 'il menu degli appunti dentro la pagina deve continuare a funzionare').toBe(true);

  // Dalle pagine di Filo, invece, tutto come prima.
  const daFilo = await app.evaluate(async () => {
    const H = globalThis.__filoHandlers;
    return H.handleMessage({ type: 'filo_get_memory' }, { url: 'filo://newtab/' });
  });
  expect(daFilo?.ok, 'le pagine di Filo devono continuare a vedere la memoria').toBe(true);
  expect(JSON.stringify(daFilo)).toContain('MILANO-SENTINELLA-589');
});

// ── Gli indirizzi che una pagina si dà da sola ─────────────────────────────
// Il confine riconosceva un sito dall'indirizzo che comincia per http, e
// trattava tutto il resto come una superficie di Filo. Ma una pagina sa uscire
// da quella forma senza smettere di essere sua: si compone una pagina e ci si
// porta sopra (l'indirizzo comincia per `blob:`), oppure apre una scheda vuota
// (`about:blank`). Senza il fix di qui il canale torna a rispondere a tutto.
test('dagli indirizzi che una pagina si dà da sola il canale resta chiuso', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(async () => {
    const m = (x) => window.filoShell.message(x);
    await m({ type: '_storage:set', obj: { filo_memory: { PROFILO: 'Vive a MILANO-INDIRIZZI-589', PREFERENZE: '' } } });
  });
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');

  // La pagina si fabbrica una pagina sua e ci si porta sopra.
  await web.evaluate(() => {
    const html = '<!doctype html><meta charset="utf-8"><h1>pagina del sito</h1>';
    location.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  });
  await expect.poll(
    () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .flatMap((w) => (w._filoTabs?.tabs || []).map((t) => String(t.url || '')))
      .find((u) => u.startsWith('blob:')) || ''),
    { timeout: 10000 },
  ).toContain('blob:');

  const risposte = await app.evaluate(async ({ BrowserWindow }) => {
    const H = globalThis.__filoHandlers;
    let wc = null; let win = null; let tab = null;
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs?.tabs || [])) {
        let u = ''; try { u = t.view.webContents.getURL(); } catch (_) {}
        if (String(u).startsWith('blob:')) { wc = t.view.webContents; win = w; tab = t; }
      }
    }
    if (!wc) return { nonTrovata: true };
    const sender = {
      tab: { id: tab.id, url: tab.url, title: tab.title },
      url: wc.getURL(), isShell: false, win, wc, frame: wc.mainFrame || null,
    };
    return {
      dentroGiraFilo: await wc.executeJavaScript('document.documentElement.dataset.filoContentReady || ""'),
      memoria: await H.handleMessage({ type: 'filo_get_memory' }, sender),
      uscita: await H.handleMessage({ type: 'auth_signout' }, sender),
    };
  });

  expect(risposte.nonTrovata, 'la pagina fabbricata dal sito non è stata trovata').toBeFalsy();
  expect(risposte.dentroGiraFilo, 'lì dentro il codice di Filo gira come su ogni pagina: è il motivo del confine').toBe('1');
  expect(JSON.stringify(risposte.memoria), 'la memoria di Filo è uscita da un indirizzo fabbricato dal sito')
    .not.toContain('MILANO-INDIRIZZI-589');
  expect(risposte.memoria?.ok).not.toBe(true);
  expect(risposte.uscita?.ok, 'da lì il sito ha potuto chiudere la sessione dell\'account').not.toBe(true);
});

// ── Il magazzino dei dati, scomparto per scomparto ─────────────────────────
// Chiedere tutto in un colpo era già vietato; chiedere gli scomparti per nome
// no, e il risultato era lo stesso. Dalla stessa porta si scriveva.
test('un sito non apre per nome gli scomparti dei dati personali, e non li riscrive', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(async () => {
    const m = (x) => window.filoShell.message(x);
    await m({ type: '_storage:set', obj: { filo_memory: { PROFILO: 'Vive a MILANO-MAGAZZINO-589', PREFERENZE: '' } } });
    await m({ type: 'save_page', page: { url: 'https://banca.example/conto', title: 'CONTO-MAGAZZINO-589', text: 'saldo' } });
  });
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  const url = web.url();

  const risposte = await app.evaluate(async ({}, u) => {
    const H = globalThis.__filoHandlers;
    const chiedi = (msg) => H.handleMessage(msg, { url: u, tab: { url: u } }).catch((e) => ({ errore: String(e) }));
    return {
      lettura: await chiedi({
        type: '_storage:get',
        keys: ['filo_memory', 'savedPages', 'aiHistory', 'downloads', 'costs', 'credits'],
      }),
      scrittura: await chiedi({ type: '_storage:set', obj: { filo_memory: { PROFILO: 'DETTATO-DAL-SITO-589' } } }),
      cancellazione: await chiedi({ type: '_storage:remove', keys: ['savedPages'] }),
      // Quello che il codice dentro le pagine tiene nel magazzino resta suo.
      dizionario: await chiedi({ type: '_storage:get', keys: ['sn_personal_dict', 'sn_autocorrect'] }),
      bozza: await chiedi({ type: '_storage:set', obj: { sn_feedback_draft_text: 'una bozza' } }),
    };
  }, url);

  const dump = JSON.stringify(risposte.lettura);
  expect(dump, 'la memoria di Filo è uscita verso il sito passando dal magazzino').not.toContain('MILANO-MAGAZZINO-589');
  expect(dump, 'le pagine salvate sono uscite verso il sito passando dal magazzino').not.toContain('CONTO-MAGAZZINO-589');
  expect(risposte.lettura?.ok, 'un sito ha aperto per nome gli scomparti dei dati personali').not.toBe(true);
  expect(risposte.dizionario?.ok, 'il dizionario personale deve restare leggibile dentro le pagine').toBe(true);
  expect(risposte.bozza?.ok, 'la bozza del feedback deve restare scrivibile dentro le pagine').toBe(true);

  const dopo = await shell.evaluate(async () => {
    const m = (x) => window.filoShell.message(x);
    const mem = await m({ type: '_storage:get', keys: ['filo_memory'] });
    const sal = await m({ type: 'get_saved_pages' });
    const pagine = sal?.pages || sal?.items || sal?.savedPages || [];
    return { memoria: JSON.stringify(mem?.value?.filo_memory ?? null), quante: Array.isArray(pagine) ? pagine.length : -1 };
  });
  expect(dopo.memoria, 'un sito ha riscritto quello che Filo ha imparato sull\'utente').toContain('MILANO-MAGAZZINO-589');
  expect(dopo.memoria).not.toContain('DETTATO-DAL-SITO-589');
  expect(dopo.quante, 'un sito ha cancellato le pagine che l\'utente aveva messo da parte').toBeGreaterThan(0);
});

// ── La fotografia è di chi la chiede ───────────────────────────────────────
// La foto tornava sempre dalla scheda ATTIVA: un sito lasciato aperto in una
// scheda di sfondo si faceva dare l'immagine di quello che l'utente aveva
// davanti in quel momento.
test('la fotografia della scheda è di chi la chiede, non di quella che l\'utente guarda', async ({ app, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<style>html,body{background:#0000ff;margin:0}</style><h1>sito</h1>');
  const sitoUrl = sito.url();
  await testServer.openReady(openTab, '<style>html,body{background:#ff0000;margin:0}</style><h1>banca</h1>');
  await expect.poll(
    () => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const t = (w._filoTabs?.tabs || []).find((x) => x.id === w._filoTabs.activeId);
      return t ? String(t.url || '') : '';
    }),
    { timeout: 8000 },
  ).not.toBe(sitoUrl);

  let scatto = null;
  await expect.poll(async () => {
    scatto = await app.evaluate(async ({ BrowserWindow }, u) => {
      const H = globalThis.__filoHandlers;
      const win = BrowserWindow.getAllWindows()[0];
      const tab = (win._filoTabs?.tabs || []).find((t) => String(t.url || '') === u);
      if (!tab) return null;
      const wc = tab.view.webContents;
      const sender = {
        tab: { id: tab.id, url: tab.url, title: tab.title },
        url: wc.getURL(), isShell: false, win, wc, frame: wc.mainFrame || null,
      };
      return H.handleMessage({ type: 'capture_visible_tab' }, sender);
    }, sitoUrl);
    return (scatto?.dataUrl || '').length;
  }, { timeout: 15000 }).toBeGreaterThan(0);

  const colore = await app.evaluate(({ nativeImage }, u) => {
    const img = nativeImage.createFromDataURL(u);
    const { width, height } = img.getSize();
    if (!width || !height) return null;
    const bmp = img.toBitmap(); // BGRA
    const i = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4;
    return { r: bmp[i + 2], g: bmp[i + 1], b: bmp[i] };
  }, scatto.dataUrl);
  if (!colore) return;

  expect(
    colore.r > 200 && colore.g < 60 && colore.b < 60,
    'la scheda di sfondo si è fatta dare la fotografia della pagina che l\'utente stava guardando',
  ).toBe(false);
});
