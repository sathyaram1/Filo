// Rilevamento siti pericolosi (src/main/services/safebrowse + content/safebrowse.js):
//
//   - il motore di verdetto (eseguito nel main) classifica correttamente
//     impersonazioni note (omoglifi cirillici, typo) come "pericoloso" e i
//     domini legittimi/infra come "safe" — asserisce il COMPORTAMENTO, non un
//     messaggio: un dominio-truffa che chiede la password DEVE essere pericoloso.
//   - la pagina Sicurezza espone i controlli personali e li persiste; la chiave
//     Google Safe Browsing NON è più un campo per-utente: è condivisa (gestita
//     dall'admin in "Modelli predefiniti") e la pagina lo dichiara.
//   - la chiave condivisa, quando presente, raggiunge DAVVERO il motore per tutti
//     gli account (asserisce che lo stadio GSB si accende), senza mai trapelare
//     il valore al renderer admin (solo un booleano "configurata").
//   - l'avviso "pericoloso" copre DAVVERO la pagina, sta sopra la scheda dove il
//     sito non arriva (#592.6), e si toglie solo dopo aver scritto "confermo" →
//     Procedi (asserisce il bypass registrato, non che un testo sia cambiato).

import { test, expect } from './fixtures/electron.mjs';
import { confermaSopraPagina, confirmState, mouseClickConfirm } from './helpers/confirm.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('motore: impersonazioni → pericoloso, domini legittimi → safe', async ({ app }) => {
  // Gira nel main process, dove SN_SAFEBROWSE è registrato su globalThis.
  const verdicts = await app.evaluate(() => {
    const SB = globalThis.SN_SAFEBROWSE;
    const v = (url, ctx) => {
      const r = SB.checkSync(url, ctx || {});
      return { level: r.level, hasMsg: !!(r.message && r.message.body) };
    };
    return {
      amazon: v('https://amazon.it/'),
      google: v('https://www.google.com/'),
      gusercontent: v('https://googleusercontent.com/'),
      cyrillicApple: v('https://xn--80ak6aa92e.com/', { hasPassword: true }),
      paypalTypo: v('https://paypa1.com/', { hasPassword: true }),
    };
  });

  // Identità legittime: nessun allarme.
  expect(verdicts.amazon.level).toBe('safe');
  expect(verdicts.google.level).toBe('safe');
  // Infra Google con "google" nel nome: NON dev'essere un falso positivo.
  expect(verdicts.gusercontent.level).toBe('safe');

  // Impersonazioni con richiesta di password: blocco a pagina piena.
  expect(verdicts.cyrillicApple.level).toBe('pericoloso');
  expect(verdicts.cyrillicApple.hasMsg).toBe(true);
  expect(verdicts.paypalTypo.level).toBe('pericoloso');
  expect(verdicts.paypalTypo.hasMsg).toBe(true);
});

test('pagina Sicurezza: controlli personali default ON e persistenti; nessun campo chiave (è condivisa)', async ({ openTab }) => {
  const page = await openTab('filo://security/');
  await page.waitForSelector('#sec-safebrowse', { timeout: 8_000 });

  // Default: tutto attivo.
  await expect(page.locator('#sec-safebrowse')).toBeChecked();
  await expect(page.locator('#sec-safebrowse-network')).toBeChecked();
  await expect(page.locator('#sec-safebrowse-llm')).toBeChecked();
  await expect(page.locator('#sec-safebrowse-sandbox')).toBeChecked();

  // La chiave NON è più un campo per-utente: il vecchio input è sparito e al suo
  // posto c'è la nota che dice che è gestita centralmente in "Modelli predefiniti".
  await expect(page.locator('#sec-safebrowse-key')).toHaveCount(0);
  const note = page.locator('#sec-safebrowse-key-managed');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Modelli predefiniti');

  // I toggle personali restano e si persistono: spegni il giudizio AI, ricarica.
  await page.locator('#sec-safebrowse-llm').uncheck();
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  await page.reload();
  await page.waitForSelector('#sec-safebrowse', { timeout: 8_000 });
  await expect(page.locator('#sec-safebrowse-llm')).not.toBeChecked();
  await expect(page.locator('#sec-safebrowse')).toBeChecked();
});

test('chiave GSB condivisa: lo store la espone come "presente" senza mai rivelarne il valore', () => {
  // defaultsStore è puro Node (niente Electron): lo carichiamo direttamente.
  const Defaults = require('../src/main/services/defaultsStore.js');

  // Senza override remoto la chiave è vuota (default), ma il CAMPO esiste nel
  // contratto della config condivisa (prima del refactor non c'era affatto).
  const eff = Defaults.get();
  expect(typeof eff.safeBrowsingKey).toBe('string');

  // La vista per l'admin espone SOLO un booleano "configurata/non", MAI il valore.
  const pub = Defaults.getPublicForAdmin();
  expect(pub).toHaveProperty('safeBrowsingKeyPresent');
  expect(typeof pub.safeBrowsingKeyPresent).toBe('boolean');
  expect(Object.prototype.hasOwnProperty.call(pub, 'safeBrowsingKey')).toBe(false);
  // Nessun campo del payload admin contiene per sbaglio una chiave grezza.
  expect(JSON.stringify(pub)).not.toContain('AIza');
});

test('chiave GSB condivisa: quando è impostata raggiunge il motore per TUTTI (stadio GSB acceso)', async ({ app }) => {
  // Simula una chiave condivisa fissata dall'admin (config/secrets su Firestore)
  // sovrascrivendo Defaults.get nel main, poi lascia che la normale catena
  // (getEffectiveSettings → withDefaults → wireSafebrowse) la propaghi al motore.
  const active = await app.evaluate(async () => {
    // In test il main espone i singleton su globalThis (require non è iniettato
    // nello scope di evaluate). Sono le STESSE istanze usate in produzione.
    const Defaults = globalThis.__filoDefaults;
    const handlers = globalThis.__filoHandlers;
    const SB = globalThis.SN_SAFEBROWSE;
    const origGet = Defaults.get;
    try {
      // 1) Senza chiave condivisa: lo stadio GSB resta spento.
      Defaults.get = () => ({ ...origGet(), safeBrowsingKey: '' });
      await handlers.wireSafebrowse();
      const off = SB.activeProviders().gsb;

      // 2) Con la chiave condivisa: si accende per tutti, senza tocco per-utente.
      Defaults.get = () => ({ ...origGet(), safeBrowsingKey: 'TEST-SHARED-GSB-KEY' });
      await handlers.wireSafebrowse();
      const on = SB.activeProviders().gsb;
      return { off, on };
    } finally {
      Defaults.get = origGet;
      await handlers.wireSafebrowse().catch(() => {});
    }
  });

  expect(active.off).toBe(false);
  expect(active.on).toBe(true);
});

// L'avviso è il popup di Filo sopra la scheda, fuori dal documento del sito (#592.6): la pagina di cui parla
// non lo vede, non lo toglie e non risponde al posto dell'utente.
function verdetto(app, level, message) {
  return app.evaluate(({ BrowserWindow }, { level, message }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        const u = t.view?.webContents?.getURL?.() || '';
        if (!/^https?:/.test(u)) continue;
        t.view.webContents.send('filo:broadcast', { type: 'safebrowse_update', level, message });
      }
    }
  }, { level, message });
}

function scelteRegistrate(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const out = { bypass: [], dismissed: [] };
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs?.tabs || [])) {
        if (t.sbBypass) out.bypass.push(...t.sbBypass);
        if (t.sbDismissed) out.dismissed.push(...t.sbDismissed);
      }
    }
    return out;
  });
}

const domandeInCoda = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.conferme.coda.length);

const PAYPAL = { title: 'Sito pericoloso', body: 'Questo non è PayPal. Il dominio è paypa1.com, ti sta chiedendo la password.' };

test('interstitial "pericoloso": copre la pagina e si toglie solo con "confermo" → Procedi', async ({ app, openTab, testServer }) => {
  // Pagina esterna reale (127.0.0.1) con i content script montati. Di per sé è
  // "safe"; iniettiamo il verdetto pericoloso come fa il main dopo l'analisi.
  const page = await testServer.openReady(openTab, '<title>SB_VICTIM</title><p>contenuto pagina</p>');
  await verdetto(app, 'pericoloso', PAYPAL);

  const vista = await confermaSopraPagina(app);
  const s = await confirmState(vista);
  expect(s.title).toBe('Sito pericoloso');
  expect(s.text).toMatch(/Questo non è PayPal/);
  expect(s.text).toMatch(/Scrivi “confermo”/);
  expect(s.text).not.toMatch(/non è reversibile/);
  expect(s).toMatchObject({ copre: true, hasInput: true, okLabel: 'Procedi comunque', cancelLabel: 'Torna indietro' });
  await expect(page.locator('#filo-safebrowse-host')).toHaveCount(0);

  // Esc e un clic fuori dal riquadro non scelgono niente; "Procedi comunque" è inerte finché non si scrive "confermo".
  await vista.waitForTimeout(600);
  await vista.keyboard.press('Escape');
  await vista.mouse.click(5, 5);
  expect(await confirmState(vista)).toMatchObject({ okDisabled: true });
  await vista.keyboard.type('confermo');
  expect(await confirmState(vista)).toMatchObject({ okDisabled: false });
  await mouseClickConfirm(vista, 'danger');

  // Dopo la conferma l'avviso sparisce e il bypass è registrato per il dominio.
  await expect.poll(() => confirmState(vista)).toBeNull();
  await expect.poll(async () => (await scelteRegistrate(app)).bypass.length).toBe(1);
  expect(await domandeInCoda(app)).toBe(0);
});

test('interstitial "pericoloso": "Torna indietro" su scheda NUOVA esce SENZA confermare il sito (#288)', async ({ app, openTab, testServer }) => {
  // Scheda appena aperta su un URL: cronologia vuota (history.length === 1), il
  // caso del bug. "Torna indietro" deve solo uscire (about:blank), MAI registrare
  // il bypass del dominio come farebbe "Procedi comunque".
  const page = await testServer.openReady(openTab, '<title>SB_BACK</title><p>contenuto pagina</p>');
  expect(await page.evaluate(() => history.length)).toBe(1);
  await verdetto(app, 'pericoloso', { title: 'Sito pericoloso', body: 'Questo non è PayPal. Ti sta chiedendo la password.' });

  const vista = await confermaSopraPagina(app);
  await vista.waitForTimeout(600);
  await mouseClickConfirm(vista, 'cancel');
  await page.waitForFunction(() => location.href === 'about:blank', null, { timeout: 6_000 });
  expect((await scelteRegistrate(app)).bypass).toEqual([]);
  await expect.poll(() => domandeInCoda(app)).toBe(0);
});

test('popup "sospetto": è un popup di conferma e si chiude solo con "Continua" (#176)', async ({ app, openTab, testServer }) => {
  // Pagina esterna reale: di per sé "safe". Iniettiamo il verdetto "sospetto"
  // come fa il main dopo l'analisi (es. il sito casinò del feedback #176).
  await testServer.openReady(openTab, '<title>SB_SUSPECT</title><p>contenuto pagina</p>');
  await verdetto(app, 'sospetto', { title: 'Sito potenzialmente sospetto', body: 'Chiede credenziali o dati personali su un dominio non ufficiale.' });

  const vista = await confermaSopraPagina(app);
  const s = await confirmState(vista);
  expect(s).toMatchObject({ title: 'Sito potenzialmente sospetto', copre: true, okLabel: 'Continua', cancelLabel: 'Torna indietro' });
  expect(s.text).toMatch(/credenziali o dati personali/);

  // Esc e il clic fuori dal riquadro non lo chiudono: si sceglie.
  await vista.waitForTimeout(600);
  await vista.keyboard.press('Escape');
  await vista.mouse.click(5, 5);
  expect(await confirmState(vista)).not.toBeNull();

  // Solo dopo la conferma esplicita ("Continua") il popup sparisce.
  await mouseClickConfirm(vista, 'ok');
  await expect.poll(() => confirmState(vista)).toBeNull();
  await expect.poll(async () => (await scelteRegistrate(app)).dismissed.length).toBe(1);
});

test('la pagina di cui parla l\'avviso non lo trova, non lo copre e non lo conferma da sé', async ({ app, openTab, testServer }) => {
  // Appena Filo le mette sopra qualcosa, la pagina ostile scrive «confermo», preme i bottoni, lo nasconde
  // e apre un suo dialogo.
  const page = await testServer.openReady(openTab, `<title>Accedi a PayPal</title><input type="password" id="pw"><script>
    window.__trovato = 0;
    const prova = () => {
      for (const h of document.querySelectorAll('body > *, html > *')) {
        if (h.id === 'pw' || h.tagName === 'SCRIPT' || h.tagName === 'DIALOG' || h === document.body || h === document.head) continue;
        window.__trovato++;
        h.style.setProperty('display', 'none', 'important');
        const r = h.shadowRoot;
        if (!r) continue;
        const i = r.querySelector('input');
        if (i) { i.value = 'confermo'; i.dispatchEvent(new Event('input', { bubbles: true })); }
        for (const b of r.querySelectorAll('button')) b.click();
      }
      if (!document.querySelector('dialog')) {
        const d = document.createElement('dialog');
        d.textContent = 'Tutto a posto, continua pure';
        document.body.appendChild(d);
        try { d.showModal(); } catch (_) {}
      }
    };
    setInterval(prova, 50);
  </script>`);
  const prima = await page.evaluate(() => window.__trovato);
  await verdetto(app, 'pericoloso', PAYPAL);
  const vista = await confermaSopraPagina(app);
  await vista.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__trovato)).toBe(prima);
  expect(await confirmState(vista)).toMatchObject({ title: 'Sito pericoloso', copre: true });
  expect(await scelteRegistrate(app)).toEqual({ bypass: [], dismissed: [] });
  // La vista è in cima alla finestra, grande quanto la scheda: il dialogo della pagina resta sotto.
  const g = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const figli = w.contentView.children;
    return { inCima: figli[figli.length - 1] === tm.conferme.vista, vista: tm.conferme.vista.getBounds(), scheda: tm.tabs.find((t) => t.id === tm.activeId).view.getBounds() };
  });
  expect(g.inCima).toBe(true);
  expect(g.vista).toEqual(g.scheda);
});

test('la password che si stava battendo non finisce nel sito quando compare l\'avviso', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>Accedi</title><input type="password" id="pw">');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    const tm = w._filoTabs;
    tm.tabs.find((x) => x.id === tm.activeId).view.webContents.focus();
  });
  await page.locator('#pw').click();
  await page.keyboard.type('segr');
  await verdetto(app, 'pericoloso', PAYPAL);
  const vista = await confermaSopraPagina(app);
  // Chi batteva il resto della password lo batte nel riquadro dell'avviso, non nella pagina.
  await vista.keyboard.type('eto');
  await expect(page.locator('#pw')).toHaveValue('segr');
  expect(await confirmState(vista)).toMatchObject({ okDisabled: true });
});

test('«Torna indietro» su una pagina che trattiene l\'indietro nel suo documento: l\'avviso torna', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>Trappola</title><p>contenuto</p>');
  await page.evaluate(() => { history.pushState({}, '', '#a'); history.pushState({}, '', '#b'); });
  await verdetto(app, 'pericoloso', PAYPAL);
  let vista = await confermaSopraPagina(app);
  await vista.waitForTimeout(600);
  await mouseClickConfirm(vista, 'cancel');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#a');
  // Stesso documento, stessa pagina pericolosa: l'avviso ricompare, e niente è stato confermato.
  vista = await confermaSopraPagina(app);
  expect(await confirmState(vista)).toMatchObject({ title: 'Sito pericoloso', copre: true });
  expect((await scelteRegistrate(app)).bypass).toEqual([]);
});

test('il verdetto cambia mentre l\'avviso è a schermo: «sospetto» lascia il posto a «pericoloso», e «sicuro» lo ritira', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<title>SB_CAMBIA</title><p>contenuto</p>');
  await verdetto(app, 'sospetto', { title: 'Sito potenzialmente sospetto', body: 'Primo indizio.' });
  const vista = await confermaSopraPagina(app);
  expect((await confirmState(vista)).title).toBe('Sito potenzialmente sospetto');
  await verdetto(app, 'pericoloso', PAYPAL);
  await expect.poll(async () => (await confirmState(vista))?.title).toBe('Sito pericoloso');
  expect(await domandeInCoda(app)).toBe(1);
  await verdetto(app, 'safe', null);
  await expect.poll(() => confirmState(vista)).toBeNull();
  await expect.poll(() => domandeInCoda(app)).toBe(0);
  expect(await scelteRegistrate(app)).toEqual({ bypass: [], dismissed: [] });
});

test('pagina pubblicata da un utente: chiudere l\'avviso su un modulo non silenzia gli altri moduli nella scheda', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<title>SB_HOSTED</title><p>contenuto</p>');
  const r = await app.evaluate(({ BrowserWindow }) => {
    const SB = globalThis.SN_SAFEBROWSE;
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm) continue;
      const tab = tm.tabs.find((t) => /^https?:/.test(t.view?.webContents?.getURL?.() || ''));
      if (!tab) continue;
      const a = 'https://docs.google.com/forms/d/e/MODULO-A/viewform';
      const b = 'https://docs.google.com/forms/d/e/MODULO-B/viewform';
      const sus = { llm: { suspicious: true, reason: null } };
      tm.safebrowseDismiss(tab.id, a);
      return {
        a: tm._sbApplyState(tab, SB.evaluate(a, {}, sus)).level,
        b: tm._sbApplyState(tab, SB.evaluate(b, {}, sus)).level,
      };
    }
    return null;
  });
  expect(r).toEqual({ a: 'safe', b: 'sospetto' });
});

// Le pagine ospitate come sono fatte davvero: il modulo di Google Sites e di Apps Script sta in un riquadro, e un
// modulo Google chiede la password in un campo di testo. Pagine servite intercettando https; il giudice fa ciò che
// il suo prompt chiede, cioè sospetta una pagina ospitata che chiede password o pagamento.
async function servi(app, pagine) {
  await app.evaluate(async ({ session, net }, pg) => {
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname] || pg[u.hostname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    });
    globalThis.SN_SAFEBROWSE.setProviders({
      sandbox: null,
      llm: async (meta) => (meta.hostedOn && (meta.hasPassword || meta.hasPayment)
        ? { suspicious: true, reasonKey: 'hosted_credentials', reason: null, confidence: 'high' } : { suspicious: false, reason: null }),
    });
  }, pagine);
}

async function livelloScheda(app, host, ms = 9000) {
  const fine = Date.now() + ms;
  let l = null;
  while (Date.now() < fine) {
    l = await app.evaluate(({ BrowserWindow }, h) => {
      for (const w of BrowserWindow.getAllWindows()) {
        for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
          try { if (new URL(t.view.webContents.getURL()).hostname === h) return t.sbLevel || null; } catch (_) {}
        }
      }
      return null;
    }, host);
    if (l === 'sospetto' || l === 'pericoloso') return l;
    await new Promise((r) => setTimeout(r, 300));
  }
  return l;
}

const ACCESSO = '<form><input name="email" placeholder="Email"><input type="password" name="pw"><button>Accedi</button></form>';

test('Google Sites: un modulo d\'accesso nel riquadro incorporato fa comparire l\'avviso', async ({ app, openTab }) => {
  await servi(app, {
    'sites.google.com/view/paypal-login': '<h1>PayPal - Accedi</h1>'
      + '<iframe src="https://1234-atari-embeds.googleusercontent.com/embeds/abc/inner.html" width="500" height="300"></iframe>',
    '1234-atari-embeds.googleusercontent.com': ACCESSO,
  });
  await openTab('https://sites.google.com/view/paypal-login');
  expect(await livelloScheda(app, 'sites.google.com')).toBe('sospetto');
});

test('Apps Script: la pagina dell\'utente in un riquadro dentro un riquadro fa comparire l\'avviso', async ({ app, openTab }) => {
  await servi(app, {
    'script.google.com/macros/s/AKfy123/exec': '<iframe src="https://n-abc-0lu-script.googleusercontent.com/panel" width="600" height="400"></iframe>',
    'n-abc-0lu-script.googleusercontent.com': '<iframe src="https://n-abc-1lu-script.googleusercontent.com/user" width="580" height="380"></iframe>',
    'n-abc-1lu-script.googleusercontent.com': `<h1>Microsoft 365</h1>${ACCESSO}`,
  });
  await openTab('https://script.google.com/macros/s/AKfy123/exec');
  expect(await livelloScheda(app, 'script.google.com')).toBe('sospetto');
});

test('modulo Google: la password chiesta in un campo di testo fa comparire l\'avviso', async ({ app, openTab }) => {
  await servi(app, {
    'docs.google.com/forms/d/e/1FAIpQL/viewform': '<h1>Verifica account di posta</h1><form>'
      + '<span id="i1">Indirizzo email</span><input type="text" aria-labelledby="i1">'
      + '<span id="i5">Password della posta</span><input type="text" aria-labelledby="i5">'
      + '<button>Invia</button></form>',
  });
  await openTab('https://docs.google.com/forms/d/e/1FAIpQL/viewform');
  expect(await livelloScheda(app, 'docs.google.com')).toBe('sospetto');
});

test('modulo Google: i dati della carta chiesti in campi di testo fanno comparire l\'avviso', async ({ app, openTab }) => {
  await servi(app, {
    'docs.google.com/forms/d/e/1FAIpQLcarta/viewform': '<h1>Rimborso: conferma la carta</h1><form>'
      + '<span id="i1">Numero della carta di credito</span><input type="text" aria-labelledby="i1">'
      + '<span id="i5">CVV</span><input type="text" aria-labelledby="i5"><button>Invia</button></form>',
  });
  await openTab('https://docs.google.com/forms/d/e/1FAIpQLcarta/viewform');
  expect(await livelloScheda(app, 'docs.google.com')).toBe('sospetto');
});

test('Microsoft Forms: la password chiesta nella seconda sezione, dopo «Avanti», fa comparire l\'avviso', async ({ app, openTab }) => {
  await servi(app, {
    'forms.cloud.microsoft/r/Sez2': '<div id="form"><span id="q1">Email aziendale</span>'
      + '<input data-automation-id="textInput" aria-labelledby="q1">'
      + '<button id="avanti" onclick="document.getElementById(\'form\').innerHTML = '
      + '\'<span id=q2>Password</span><input data-automation-id=textInput aria-labelledby=q2>\'">Avanti</button></div>',
  });
  const page = await openTab('https://forms.cloud.microsoft/r/Sez2');
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(3500);
  expect(await livelloScheda(app, 'forms.cloud.microsoft', 500)).toBe('safe');
  await page.click('#avanti');
  await expect(page.getByText('Password')).toBeVisible();
  expect(await livelloScheda(app, 'forms.cloud.microsoft')).toBe('sospetto');
});

test('Google Sites: un modulo montato secondi dopo il caricamento del riquadro fa comparire l\'avviso', async ({ app, openTab }) => {
  await servi(app, {
    'sites.google.com/view/posta-lenta': '<h1>Accesso alla posta</h1>'
      + '<iframe src="https://5678-atari-embeds.googleusercontent.com/embeds/x/user.html" width="500" height="300"></iframe>',
    '5678-atari-embeds.googleusercontent.com': '<p>Caricamento…</p><script>'
      + `setTimeout(() => { document.body.innerHTML = ${JSON.stringify(ACCESSO)}; }, 4000);</script>`,
  });
  await openTab('https://sites.google.com/view/posta-lenta');
  expect(await livelloScheda(app, 'sites.google.com', 12000)).toBe('sospetto');
});
