// Verifica #589 — giro 2, ri-provato nel giro 5 (la domanda della memoria è uscita
// in un rilievo esterno, e la sua prova con lui). La segnalazione chiedeva due
// cose: che la spinta delle impostazioni verso le schede applichi la stessa riduzione delle
// letture, e che «verso le origini web viaggi solo ciò che i content script
// usano davvero».
//
// La prima parte è provata dal giro 1 (giro1-segreti-verso-le-pagine.spec.mjs)
// e resta verde. Qui si guarda la seconda, sulla stessa strada e con lo stesso
// metodo del giro 1: che cosa ottiene, dall'indirizzo di un sito, chi CHIEDE.
//
// Il modello di minaccia è quello scritto nella segnalazione: oggi il codice
// che Filo carica dentro una pagina vive in un mondo isolato, quindi il sito
// non arriva da solo a questo canale; è difesa in profondità, e vale finché
// l'isolamento regge. La domanda è la stessa: se il confine cede, che cosa
// c'è dall'altra parte?
//
// Le richieste partono con l'indirizzo del sito, come se le facesse il codice
// che gira dentro quella pagina.

import { test, expect } from '../../fixtures/electron.mjs';

// Una richiesta al cuore di Filo fatta con l'indirizzo del sito aperto, cioè
// come la farebbe il codice che Filo carica dentro quella pagina.
function comeIlSito(app, url) {
  return (msg) => app.evaluate(async ({ BrowserWindow }, { pageUrl, messaggio }) => {
    const H = globalThis.__filoHandlers;
    const win = BrowserWindow.getAllWindows()[0];
    const host = new URL(pageUrl).host;
    const tab = win._filoTabs?.tabs?.find((t) => String(t.url || '').includes(host)) || null;
    const sender = {
      tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : { id: 0, url: pageUrl, title: '' },
      url: pageUrl,
      isShell: false,
      win,
      wc: tab ? tab.view.webContents : null,
      frame: tab ? tab.view.webContents.mainFrame : null,
    };
    try { return await H.handleMessage(messaggio, sender); } catch (e) { return { errore: String(e) }; }
  }, { pageUrl: url, messaggio: msg });
}

test('un sito non può far uscire l\'utente dal suo account', async ({ app, openTab, testServer }) => {
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const chiedi = comeIlSito(app, web.url());

  // (L'accesso, al contrario, un sito lo può CHIEDERE per disegno: il modulo
  // del red team vive dentro le pagine e propone di connettersi. È l'USCITA
  // che nessun codice dentro una pagina chiede mai.)
  const uscita = await chiedi({ type: 'auth_signout' });
  expect(uscita?.ok, 'un sito ha potuto chiudere la sessione dell\'account dell\'utente').not.toBe(true);
});

// ── Porta del giro 1: da ri-provare a ogni giro ────────────────────────────
// Lo stato dell'account non deve né arrivare da solo ai siti (provato nel giro
// 1) né uscire se un sito lo CHIEDE.
// Giro 5: su main la risposta a un sito porta i booleani che servono a
// disegnare (sei connesso, sei amministratore), mai l'identità.
test('a un sito che chiede lo stato dell\'account arrivano solo booleani, mai l\'identità', async ({ app, shell, openTab, testServer }) => {
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const chiedi = comeIlSito(app, web.url());

  const versoSito = await chiedi({ type: 'auth_status' });
  expect(versoSito?.ok).toBe(true);
  expect(typeof versoSito?.signedIn, 'al sito serve sapere se c\'è una sessione').toBe('boolean');
  for (const [k, v] of Object.entries(versoSito)) {
    expect(typeof v, `al sito è arrivato "${k}", che non è un sì o un no`).toBe('boolean');
  }

  const versoFilo = await shell.evaluate(() => window.filoShell.message({ type: 'auth_status' }));
  expect(versoFilo?.ok).toBe(true);
  expect('profile' in versoFilo, 'le pagine di Filo devono continuare a vedere il profilo').toBe(true);
});

// ── La stessa spinta, l'altra finestra ─────────────────────────────────────
// Il riparo sceglie che cosa mandare guardando l'indirizzo di ogni riquadro
// delle schede, ma alla finestra manda l'oggetto intero senza guardare niente,
// dando per scontato che ogni finestra sia una superficie di Filo. Non lo è:
// i popup di accesso ("Continua con Google") sono finestre vere, e dentro
// girano le pagine di un sito con il codice di Filo montato sopra.
test('un popup di accesso è una pagina di un sito: non deve ricevere chiavi e proxy', async ({ app, shell, openTab, testServer }) => {
  const CHIAVE = 'sk-or-v1-GIRO2-589-POPUP';
  const PWD = 'PWD-GIRO2-589-POPUP';
  await shell.evaluate(({ k, p }) => window.filoShell.message({
    type: 'update_settings',
    settings: { apiKeys: { openrouter: k }, proxy: { datacenter: `socks5://utente:${p}@gate.example.com:7000` } },
  }), { k: CHIAVE, p: PWD });

  const web = await testServer.openReady(openTab, '<h1>sito con accesso</h1>');
  // La pagina che il sito apre nel popup: un indirizzo che somiglia a un login
  // OAuth, come quello di un "Continua con Google".
  const login = `${testServer.html('<h1>accedi</h1>')}?client_id=abc&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await web.evaluate((u) => window.open(u, '_blank'), login);

  // Aspetta che la finestra del popup esista davvero.
  await expect.poll(
    () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => {
      try { return w.webContents.getURL(); } catch (_) { return ''; }
    })),
    { timeout: 8000 },
  ).toContain(login);

  // Registra quello che arriva a ogni superficie, con l'indirizzo di chi riceve.
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__g2 = [];
    const nota = (url, m) => {
      if (!m || m.type !== 'settings_updated') return;
      let dump = ''; try { dump = JSON.stringify(m.settings ?? null); } catch (_) { dump = ''; }
      globalThis.__g2.push({ url: String(url || ''), dump });
    };
    const win = BrowserWindow.getAllWindows()[0];
    const wcP = Object.getPrototypeOf(win.webContents);
    const wcSend = wcP.send;
    wcP.send = function (ch, ...a) {
      if (ch === 'filo:broadcast') { let u = ''; try { u = this.getURL(); } catch (_) {} nota(u, a[0]); }
      return wcSend.call(this, ch, ...a);
    };
    // La consegna può passare dal singolo riquadro invece che dalla finestra:
    // guardiamo tutte e due le strade, altrimenti si rischia di non vedere
    // proprio quella che porta il carico.
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

  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await expect.poll(() => app.evaluate(() => (globalThis.__g2 || []).length), { timeout: 8000 }).toBeGreaterThan(0);

  // Dentro quel popup il codice di Filo gira per intero, come su ogni pagina:
  // quello che arriva lì non resta in un angolo, lo prende in mano lui.
  const dentroIlPopup = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => {
      try { return x.webContents.getURL().includes('client_id'); } catch (_) { return false; }
    });
    if (!w) return '';
    try { return await w.webContents.executeJavaScript('document.documentElement.dataset.filoContentReady || ""'); }
    catch (_) { return ''; }
  });
  expect(dentroIlPopup, 'nel popup il codice di Filo dovrebbe essere montato come su ogni pagina').toBe('1');

  const consegne = await app.evaluate(() => globalThis.__g2 || []);
  const versoPopup = consegne.filter((c) => /^https?:/.test(c.url));
  expect(versoPopup.length, 'il popup non ha ricevuto niente: la prova non ha guardato quello che doveva').toBeGreaterThan(0);
  for (const c of versoPopup) {
    expect(c.dump, `la chiave dei servizi a pagamento è finita nel popup aperto dal sito (${c.url})`).not.toContain(CHIAVE);
    expect(c.dump, `la password del proxy è finita nel popup aperto dal sito (${c.url})`).not.toContain(PWD);
  }
});

// ── Il lavoro chiesto, ri-provato dal verso dell'utente ────────────────────
// Senza il fix questa è rossa: la preferenza salvata arrivava alla pagina con
// dentro le chiavi. Qui si guarda anche che la difesa non abbia spento niente.
test('cambiare una preferenza continua a valere sul sito, senza portarci i segreti', async ({ app, shell, openTab, testServer }) => {
  const CHIAVE = 'sk-or-v1-GIRO2-589-CHIAVE';
  await shell.evaluate((k) => window.filoShell.message({
    type: 'update_settings',
    settings: { apiKeys: { openrouter: k }, proxy: { datacenter: `socks5://u:PWD-GIRO2-589@gate.example.com:7000` } },
  }), CHIAVE);

  const web = await testServer.openReady(openTab, '<h1>pagina</h1>');
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await expect.poll(() => web.evaluate(() => document.documentElement.getAttribute('data-sn-theme'))).toBe('dark');

  // E quello che il sito può farsi dare, chiedendolo, resta ripulito.
  const chiedi = comeIlSito(app, web.url());
  const lette = await chiedi({ type: 'get_settings' });
  const dump = JSON.stringify(lette ?? null);
  expect(dump, 'la chiave dei servizi a pagamento è uscita verso il sito').not.toContain(CHIAVE);
  expect(dump, 'la password del proxy è uscita verso il sito').not.toContain('PWD-GIRO2-589');
  expect(lette?.settings?.theme, 'al sito deve continuare ad arrivare il tema').toBe('dark');
});
