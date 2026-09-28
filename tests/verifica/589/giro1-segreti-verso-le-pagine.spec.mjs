// Verifica #589 — giro 1. Le impostazioni che Filo spinge alle schede non
// devono portare i segreti dell'utente dentro le pagine dei siti.
//
// Il sintomo: quando l'utente salva una preferenza, Filo aggiorna tutte le
// schede aperte. Quell'aggiornamento arrivava anche ai siti esterni con dentro
// le chiavi dei servizi a pagamento e utente/password del proxy.
//
// Queste prove guardano il problema dal lato di CHI RICEVE, non dal lato di chi
// spedisce: che cosa arriva davvero a ogni riquadro di ogni scheda, che cosa
// può leggere una pagina ostile dal proprio documento, e che cosa succede se i
// valori salvati sono strani o enormi. In più: la difesa non deve aver spento
// niente — tema, correttore e siti esclusi devono continuare a funzionare.

import { test, expect } from '../../fixtures/electron.mjs';

const CHIAVE = 'sk-or-v1-VERIFICA589-CHIAVE-SEGRETA';
const PWD = 'VERIFICA589-PASSWORD-PROXY';
const PROXY = `socks5://utente:${PWD}@gate.example.com:7000`;

// Registra ogni aggiornamento di impostazioni consegnato a un riquadro, con
// l'indirizzo del riquadro che lo riceve. È l'ultimo passaggio prima della
// pagina: quello che si vede qui è quello che la pagina ha davvero in mano.
async function spia(app) {
  await app.evaluate(({ BrowserWindow }) => {
    if (globalThis.__v589) return;
    globalThis.__v589 = [];
    const nota = (url, m) => {
      if (m && m.type === 'settings_updated') {
        globalThis.__v589.push({ url: String(url || ''), settings: m.settings });
      }
    };
    const win = BrowserWindow.getAllWindows()[0];
    const wcP = Object.getPrototypeOf(win.webContents);
    const wcSend = wcP.send;
    wcP.send = function (ch, ...a) {
      if (ch === 'filo:broadcast') { let u = ''; try { u = this.getURL(); } catch (_) {} nota(u, a[0]); }
      return wcSend.call(this, ch, ...a);
    };
    const fr = win.webContents.mainFrame;
    if (fr) {
      const frP = Object.getPrototypeOf(fr);
      const frSend = frP.send;
      frP.send = function (ch, ...a) {
        if (ch === 'filo:broadcast') { let u = ''; try { u = this.url; } catch (_) {} nota(u, a[0]); }
        return frSend.call(this, ch, ...a);
      };
    }
  });
}

const consegne = (app) => app.evaluate(() => globalThis.__v589 || []);
const azzera = (app) => app.evaluate(() => { globalThis.__v589 = []; });

const salva = (shell, settings) =>
  shell.evaluate((s) => window.filoShell.message({ type: 'update_settings', settings: s }), settings);

const configuraSegreti = (shell) => salva(shell, {
  apiKeys: { openrouter: CHIAVE, gemini: CHIAVE },
  proxy: { datacenter: PROXY, residential: PROXY },
});

// Tutto quello che una pagina può leggere da sé: il proprio documento (Filo ci
// inietta i suoi menu e riquadri), gli attributi, gli stili, e qualunque cosa
// sia finita su `window`. Se un segreto è arrivato fin qui, il sito lo ha.
const superficieDellaPagina = (page) => page.evaluate(() => {
  const pezzi = [document.documentElement.outerHTML];
  try {
    for (const k of Object.getOwnPropertyNames(window)) {
      try {
        const v = window[k];
        if (v && (typeof v === 'object' || typeof v === 'string')) {
          pezzi.push(k + '=' + JSON.stringify(v).slice(0, 20000));
        }
      } catch (_) {}
    }
  } catch (_) {}
  try { pezzi.push(JSON.stringify(localStorage)); } catch (_) {}
  return pezzi.join('\n');
});

test('un sito aperto non riceve né può leggere le chiavi e le credenziali del proxy', async ({ app, shell, openTab, testServer }) => {
  await configuraSegreti(shell);

  // Una pagina esterna con dentro un riquadro incorporato: i content script di
  // Filo girano in entrambi, quindi entrambi ricevono l'aggiornamento.
  const dentro = testServer.html('<h1>riquadro</h1><p>testo del riquadro</p>');
  const web = await testServer.openReady(
    openTab,
    `<h1>pagina esterna</h1><p>testo</p><iframe src="${dentro}" width="300" height="200"></iframe>`,
  );
  const interna = await openTab('filo://preferences/preferences.html');

  await spia(app);
  await salva(shell, { theme: 'dark' });

  // Il cambio arriva davvero alla pagina esterna (la difesa non ha spento nulla).
  await expect.poll(() => web.evaluate(() => document.documentElement.getAttribute('data-sn-theme')))
    .toBe('dark');

  const tutte = await consegne(app);
  expect(tutte.length, 'nessun aggiornamento consegnato').toBeGreaterThan(0);

  const versoSito = tutte.filter((c) => /^https?:/.test(c.url));
  expect(versoSito.length, 'la pagina esterna non ha ricevuto nulla').toBeGreaterThan(0);
  // Il riquadro incorporato è un frame a parte: deve essere trattato come il resto del sito.
  expect(versoSito.length, 'il riquadro incorporato non è stato contato').toBeGreaterThan(1);
  for (const c of versoSito) {
    const dump = JSON.stringify(c.settings ?? null);
    expect(dump, `chiave consegnata a ${c.url}`).not.toContain(CHIAVE);
    expect(dump, `password del proxy consegnata a ${c.url}`).not.toContain(PWD);
    expect(dump, `indirizzo del proxy consegnato a ${c.url}`).not.toContain('gate.example.com');
  }

  // E dal punto di vista del sito: niente di tutto ciò è leggibile dalla pagina.
  const superficie = await superficieDellaPagina(web);
  expect(superficie).not.toContain(CHIAVE);
  expect(superficie).not.toContain(PWD);

  // Le superfici di Filo continuano a ricevere tutto: è lì che servono.
  const versoFilo = tutte.filter((c) => c.url.startsWith('filo://'));
  expect(versoFilo.some((c) => JSON.stringify(c.settings ?? null).includes(CHIAVE)),
    'le pagine di Filo devono continuare a ricevere le impostazioni intere').toBe(true);
  await expect.poll(() => interna.evaluate(() => document.documentElement.getAttribute('data-sn-theme')))
    .toBe('dark');
});

test('quello che il sito riceve resta pulito anche con valori assurdi e salvataggi a raffica', async ({ app, shell, openTab, testServer }) => {
  await configuraSegreti(shell);
  const web = await testServer.openReady(openTab, '<h1>pagina</h1><textarea>scrivi</textarea>');
  await spia(app);

  const lungo = 'x'.repeat(10000);
  const cattivi = [
    { theme: 'light' },
    { theme: '   ' },
    { blocklist: [] },
    { blocklist: [lungo, '', '   ', '<script>alert(1)</script>', '😀.example', 'a\u0000b'] },
    { apiKeys: { openrouter: CHIAVE + '-BIS' } },
    { proxy: { datacenter: PROXY, extra: { nascosto: CHIAVE } } },
    { tts: { voice: '😀'.repeat(500), rate: Number.NaN, pitch: -1 } },
    { themeTokens: { accent: '#112233' } },
  ];
  // A raffica, senza aspettare: è l'uso "male" che Filo deve reggere.
  await Promise.all(cattivi.map((s) => salva(shell, s).catch(() => null)));

  await expect.poll(async () => (await consegne(app)).length, { timeout: 10000 }).toBeGreaterThan(0);
  const tutte = await consegne(app);
  for (const c of tutte.filter((x) => /^https?:/.test(x.url))) {
    const dump = JSON.stringify(c.settings ?? null);
    expect(dump, `segreto uscito verso ${c.url}`).not.toContain('VERIFICA589-CHIAVE-SEGRETA');
    expect(dump, `password del proxy uscita verso ${c.url}`).not.toContain(PWD);
    expect(c.settings?.apiKeys).toBeUndefined();
    expect(c.settings?.proxy).toBeUndefined();
  }

  // La pagina è ancora viva e Filo ci funziona ancora sopra.
  expect(await web.evaluate(() => document.documentElement.dataset.filoReady)).toBe('1');
  const superficie = await superficieDellaPagina(web);
  expect(superficie).not.toContain('VERIFICA589-CHIAVE-SEGRETA');
  expect(superficie).not.toContain(PWD);
  await azzera(app);
});

test('una pagina ostile non ottiene i segreti nemmeno chiedendoli per ogni strada', async ({ app, shell, openTab, testServer }) => {
  await configuraSegreti(shell);
  const web = await testServer.openReady(openTab, '<h1>sito ostile</h1>');
  const url = web.url();

  // Le strade che un content script può percorrere verso il main, chiamate con
  // l'indirizzo del sito: nessuna deve restituire chiavi o proxy.
  const risposte = await app.evaluate(async ({}, pageUrl) => {
    const H = globalThis.__filoHandlers;
    const chiedi = (msg) => H.handleMessage(msg, { url: pageUrl, tab: { url: pageUrl } }).catch((e) => ({ errore: String(e) }));
    return {
      get: await chiedi({ type: 'get_settings' }),
      storageSettings: await chiedi({ type: '_storage:get', keys: ['settings'] }),
      storageTutto: await chiedi({ type: '_storage:get', keys: null }),
      update: await chiedi({ type: 'update_settings', settings: { theme: 'light' } }),
      reset: await chiedi({ type: 'reset_settings' }),
    };
  }, url);

  for (const [nome, r] of Object.entries(risposte)) {
    const dump = JSON.stringify(r ?? null);
    expect(dump, `${nome} ha restituito la chiave al sito`).not.toContain(CHIAVE);
    expect(dump, `${nome} ha restituito la password del proxy al sito`).not.toContain(PWD);
  }
  // Ma le strade che servono davvero al content script restano aperte.
  expect(risposte.get?.settings?.theme, 'il tema deve arrivare al content script').toBeTruthy();
  expect(risposte.storageSettings?.ok).toBe(true);

  // E un sito non può riscrivere le chiavi dell'utente con le proprie.
  await app.evaluate(async ({}, pageUrl) => {
    const H = globalThis.__filoHandlers;
    await H.handleMessage(
      { type: 'update_settings', settings: { apiKeys: { openrouter: 'CHIAVE-DELL-ATTACCANTE' } } },
      { url: pageUrl, tab: { url: pageUrl } },
    ).catch(() => null);
  }, url);
  const dopo = await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }));
  expect(dopo?.settings?.apiKeys?.openrouter, 'un sito ha riscritto la chiave dell\'utente').toBe(CHIAVE);
});

// Nota del giro: la lista dei siti esclusi ARRIVA alla pagina (è fra i campi
// ammessi, e la prova qui sotto lo verifica), ma una pagina già aperta continua
// a mostrare il menu di Filo finché non la si ricarica. È il content script che
// decide una volta sola, al caricamento: è un pezzo che questo lavoro non ha
// toccato. Sta nella critica come rilievo a sé.

test('al sito arriva tutto quello che gli serve e nient\'altro', async ({ app, shell, openTab, testServer }) => {
  await configuraSegreti(shell);
  const web = await testServer.openReady(openTab, '<h1>pagina</h1>');
  await spia(app);
  await azzera(app);

  await salva(shell, { theme: 'light', featureFlags: { spellcheck: false }, themeTokens: { accent: '#ff8800' } });
  await expect.poll(() => web.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sn-accent').trim()))
    .toBe('#ff8800');

  const versoSito = (await consegne(app)).filter((c) => /^https?:/.test(c.url));
  expect(versoSito.length).toBeGreaterThan(0);
  const ammessi = new Set(['theme', 'themeTokens', 'tabColor', 'featureFlags', 'blocklist', 'tts', 'models', 'modelRegistry']);
  for (const c of versoSito) {
    for (const k of Object.keys(c.settings || {})) {
      expect(ammessi.has(k), `al sito è arrivato il campo "${k}", che i content script non usano`).toBe(true);
    }
    expect(c.settings?.theme).toBe('light');
    expect(c.settings?.featureFlags?.spellcheck, 'il flag del correttore deve arrivare alla pagina').toBe(false);
  }
});

// ── La stessa strada, l'altro carico ────────────────────────────────────────
// L'aggiornamento delle impostazioni non è l'unica cosa che Filo spinge a tutte
// le schede: sulla stessa strada viaggia anche il cambio di stato dell'account.
// Quel messaggio porta il profilo Google dell'utente (email, nome, foto) e il
// flag di amministratore, e lo leggono solo le pagine di Filo — nessun content
// script dei siti lo usa. Qui si guarda se arriva lo stesso ai siti aperti.
async function spiaTutto(app) {
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__v589tutti = [];
    const nota = (url, m) => {
      if (m && m.type) globalThis.__v589tutti.push({ url: String(url || ''), tipo: m.type, dump: (() => { try { return JSON.stringify(m); } catch (_) { return ''; } })() });
    };
    const win = BrowserWindow.getAllWindows()[0];
    const fr = win.webContents.mainFrame;
    if (fr && !globalThis.__v589tuttiFr) {
      globalThis.__v589tuttiFr = true;
      const frP = Object.getPrototypeOf(fr);
      const frSend = frP.send;
      frP.send = function (ch, ...a) {
        if (ch === 'filo:broadcast') { let u = ''; try { u = this.url; } catch (_) {} nota(u, a[0]); }
        return frSend.call(this, ch, ...a);
      };
    }
    if (!globalThis.__v589tuttiWc) {
      globalThis.__v589tuttiWc = true;
      const wcP = Object.getPrototypeOf(win.webContents);
      const wcSend = wcP.send;
      wcP.send = function (ch, ...a) {
        if (ch === 'filo:broadcast') { let u = ''; try { u = this.getURL(); } catch (_) {} nota(u, a[0]); }
        return wcSend.call(this, ch, ...a);
      };
    }
  });
}

test('il cambio di stato dell\'account non deve finire nelle pagine dei siti', async ({ app, openTab, shell, testServer }) => {
  await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  await spiaTutto(app);

  // Un cambio di stato dell'account: è la stessa spinta che parte all'accesso.
  await shell.evaluate(() => window.filoShell.message({ type: 'auth_signout' }));

  const tutti = await app.evaluate(() => globalThis.__v589tutti || []);
  const versoSito = tutti.filter((c) => /^https?:/.test(c.url) && c.tipo === 'auth_changed');
  expect(
    versoSito.map((c) => c.url),
    'lo stato dell\'account (profilo e flag di amministratore) è stato spinto anche ai siti aperti, che non lo usano',
  ).toEqual([]);
});
