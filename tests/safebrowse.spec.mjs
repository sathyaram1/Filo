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
//   - l'avviso sta in una vista sopra la scheda, fuori dalla pagina (#813.5): la
//     copre, ha la tastiera, la pagina non sente niente, non lo copre né lo
//     cancella, e si toglie solo dai suoi pulsanti ("confermo" → Procedi).

import { test, expect } from './fixtures/electron.mjs';
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
      parolaComune: v('https://team.com/'),
      parolaComuneConPassword: v('https://team.com/', { hasPassword: true }),
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

  // #728 — una parola comune a una lettera da un marchio corto avvisa e basta;
  // il blocco torna appena un secondo segnale lo conferma.
  expect(verdicts.parolaComune.level).toBe('sospetto');
  expect(verdicts.parolaComuneConPassword.level).toBe('pericoloso');
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

// L'avviso sta in una vista sopra la scheda (#813.5), non nella pagina: qui la si trova, si guarda cosa copre e si
// scrive come scrive la tastiera vera, nel webContents che ha il fuoco.
async function vistaAvviso(app, ms = 8000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/avviso-sito.html'); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('la vista dell\'avviso non è nata');
}

function copertura(app) {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm) continue;
      const tab = tm.tabs.find((t) => t.id === tm.activeId);
      const v = tm.avvisoSito.vista;
      const figli = w.contentView.children;
      const vb = v ? v.getBounds() : null;
      const tb = tab.view.getBounds();
      const col = webContents.getFocusedWebContents();
      let tastiera = 'altro';
      if (v && col === v.webContents) tastiera = 'avviso';
      else if (col === tab.view.webContents) tastiera = 'pagina';
      return {
        coperta: tm.avvisoSito.coperta() === tab,
        sopra: !!v && figli.indexOf(v) > figli.indexOf(tab.view),
        stessiBordi: !!vb && vb.x === tb.x && vb.y === tb.y && vb.width === tb.width && vb.height === tb.height && tb.width > 0,
        tastiera,
      };
    }
    return null;
  });
}

async function scriviDallaTastiera(app, testo) {
  await app.evaluate(({ webContents }, t) => {
    const wc = webContents.getFocusedWebContents();
    if (!wc) throw new Error('nessun webContents ha la tastiera');
    for (const ch of t) {
      const tasto = ch === '\r' ? 'Return' : ch;
      wc.sendInputEvent({ type: 'keyDown', keyCode: tasto });
      wc.sendInputEvent({ type: 'char', keyCode: ch });
      wc.sendInputEvent({ type: 'keyUp', keyCode: tasto });
    }
  }, testo);
}

const COPERTA = { coperta: true, sopra: true, stessiBordi: true, tastiera: 'avviso' };
const SEGNALATO = 'Sito segnalato come pericoloso';

test('interstitial "pericoloso": copre la pagina e si toglie solo con "confermo" → Procedi', async ({ app, shell }) => {
  await serviInCaricamento(app, { 'conto-paypa1.com/login': MODULO + '<input id="campo">' }, { gsbListed: true });
  const page = await apriSenzaAspettare(app, shell, 'https://conto-paypa1.com/login');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 6_000 });
  await expect(avviso.getByText(/Google Safe Browsing classifica conto-paypa1\.com/)).toBeVisible();
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  // Nella pagina del sito non c'è niente di Filo da coprire, spostare o premere.
  await page.waitForLoadState('domcontentloaded');
  expect(await page.evaluate(() => document.querySelectorAll('[id^="filo-safebrowse"]').length)).toBe(0);

  const proceed = avviso.getByRole('button', { name: 'Procedi comunque' });
  await expect(proceed).toBeDisabled();
  await scriviDallaTastiera(app, 'confermo');
  await expect(avviso.getByPlaceholder('confermo')).toHaveValue('confermo');
  await proceed.click();

  // Bypass registrato: l'avviso va via, non torna col verdetto ripetuto, e la tastiera torna alla pagina.
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  await expect.poll(async () => (await copertura(app)).tastiera).toBe('pagina');
  await page.waitForTimeout(2000);
  expect((await copertura(app)).coperta).toBe(false);
  await page.locator('#campo').fill('ok');
  await expect(page.locator('#campo')).toHaveValue('ok');
});

test('interstitial "pericoloso": "Torna indietro" su scheda NUOVA esce SENZA confermare il sito (#288)', async ({ app, shell }) => {
  await serviInCaricamento(app, { 'conto-indietro.com/login': MODULO }, { gsbListed: true });
  const page = await apriSenzaAspettare(app, shell, 'https://conto-indietro.com/login');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 6_000 });
  await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
  expect(await page.evaluate(() => history.length)).toBe(1);

  await avviso.getByRole('button', { name: 'Torna indietro' }).click();
  await page.waitForFunction(() => location.href === 'about:blank', null, { timeout: 6_000 });
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);

  // Nessun dominio confermato: «Torna indietro» non è mai «Procedi comunque».
  const bypassed = await app.evaluate(({ BrowserWindow }) => {
    const all = [];
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs && w._filoTabs.tabs) || []) if (t.sbBypass && t.sbBypass.size) all.push(...t.sbBypass);
    }
    return all;
  });
  expect(bypassed).toEqual([]);
});

test('popup "sospetto": è un popup di conferma e si chiude solo con "Continua" (#176)', async ({ app, shell }) => {
  await serviInCaricamento(app, { 'area-riservata-popup.it/accesso': MODULO });
  const page = await apriSenzaAspettare(app, shell, 'http://area-riservata-popup.it/accesso');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Sito potenzialmente sospetto')).toBeVisible({ timeout: 8_000 });
  await expect(avviso.getByRole('button', { name: 'Ho capito' })).toHaveCount(0);
  await expect(avviso.getByRole('button', { name: 'Torna indietro' })).toBeVisible();
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  // Comparso sotto le dita di chi scriveva, «Continua» non si prende l'Invio che era per la pagina.
  const proceed = avviso.getByRole('button', { name: 'Continua' });
  await scriviDallaTastiera(app, '\r');
  expect((await copertura(app)).coperta).toBe(true);
  await expect(proceed).toBeEnabled({ timeout: 3_000 });
  await proceed.click();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  await page.locator('#pw').fill('segreto');
  await expect(page.locator('#pw')).toHaveValue('segreto');
});

// Un questionario Microsoft aperto per esteso (/Pages/ResponsePage.aspx?id=…) ha lo stesso percorso di tutti gli altri.
for (const [cosa, a, b] of [
  ['un modulo Google', 'https://docs.google.com/forms/d/e/MODULO-A/viewform', 'https://docs.google.com/forms/d/e/MODULO-B/viewform'],
  ['un questionario Microsoft', 'https://customervoice.microsoft.com/Pages/ResponsePage.aspx?id=QA', 'https://customervoice.microsoft.com/Pages/ResponsePage.aspx?id=QB'],
]) {
  test(`pagina pubblicata da un utente: chiudere l'avviso su ${cosa} non silenzia gli altri nella scheda`, async ({ app, openTab, testServer }) => {
    await testServer.openReady(openTab, '<title>SB_HOSTED</title><p>contenuto</p>');
    const r = await app.evaluate(({ BrowserWindow }, { a, b }) => {
      const SB = globalThis.SN_SAFEBROWSE;
      for (const w of BrowserWindow.getAllWindows()) {
        const tm = w._filoTabs;
        if (!tm) continue;
        const tab = tm.tabs.find((t) => /^https?:/.test(t.view?.webContents?.getURL?.() || ''));
        if (!tab) continue;
        const sus = { llm: { suspicious: true, reason: null } };
        tm.safebrowseDismiss(tab.id, a);
        return {
          a: tm._sbApplyState(tab, SB.evaluate(a, {}, sus)).level,
          b: tm._sbApplyState(tab, SB.evaluate(b, {}, sus)).level,
        };
      }
      return null;
    }, { a, b });
    expect(r).toEqual({ a: 'safe', b: 'sospetto' });
  });
}

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

test('Microsoft Customer Voice: la password chiesta nel questionario fa comparire l\'avviso', async ({ app, openTab }) => {
  await servi(app, {
    'customervoice.microsoft.com/Pages/ResponsePage.aspx': '<h1>Verifica della casella aziendale</h1><form>'
      + '<span id="q1">Email aziendale</span><input data-automation-id="textInput" aria-labelledby="q1">'
      + '<span id="q2">Password</span><input data-automation-id="textInput" aria-labelledby="q2"><button>Invia</button></form>',
  });
  await openTab('https://customervoice.microsoft.com/Pages/ResponsePage.aspx?id=QzVerifica1');
  expect(await livelloScheda(app, 'customervoice.microsoft.com')).toBe('sospetto');
});

test('Hugging Face Spaces: un modulo d\'accesso nell\'app dell\'utente, nel suo riquadro, fa comparire l\'avviso', async ({ app, openTab }) => {
  await servi(app, {
    'huggingface.co/spaces/qualcuno/accesso-posta': '<h1>Accesso alla posta</h1>'
      + '<iframe src="https://qualcuno-accesso-posta.hf.space/?__theme=light" width="600" height="400"></iframe>',
    'qualcuno-accesso-posta.hf.space': ACCESSO,
  });
  await openTab('https://huggingface.co/spaces/qualcuno/accesso-posta');
  expect(await livelloScheda(app, 'huggingface.co')).toBe('sospetto');
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

// Una pagina che non finisce di caricarsi (#813.1): il modulo è già a schermo, lo script dopo non arriva mai. Il server
// tiene aperto lo script finché la prova non lo chiude, e la scheda si apre senza aspettare il DOMContentLoaded.
async function serviInCaricamento(app, pagine, providers) {
  await app.evaluate(async ({ session, net }, { pg, gsbListed, ospitate }) => {
    globalThis.__sbLenti = [];
    const risposta = (req) => {
      const u = new URL(req.url);
      if (u.pathname === '/lento.js') {
        const body = new ReadableStream({ start: (c) => { globalThis.__sbLenti.push(c); } });
        return new Response(body, { headers: { 'content-type': 'text/javascript' } });
      }
      const html = pg[u.hostname + u.pathname];
      if (html && u.searchParams.has('tardi')) {
        const body = new ReadableStream({ start: (c) => { globalThis.__sbLenti.push(c); setTimeout(() => { try { c.enqueue(new TextEncoder().encode(html)); } catch (_) {} }, 1500); } });
        return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({
      gsb: gsbListed ? async () => ({ listed: true, category: 'phishing' }) : null,
      rdap: null, ct: null, sandbox: null,
      llm: async (meta) => (ospitate && meta.hostedOn && (meta.hasPassword || meta.hasPayment)
        ? { suspicious: true, reasonKey: 'hosted_credentials', reason: null, confidence: 'high' } : { suspicious: false, reason: null }),
    });
  }, { pg: pagine, gsbListed: !!(providers && providers.gsbListed), ospitate: !!(providers && providers.ospitate) });
}

async function chiudiLenti(app) {
  await app.evaluate(() => { for (const c of globalThis.__sbLenti || []) { try { c.close(); } catch (_) {} } }).catch(() => {});
}

// Appena la scheda c'è, l'utente ci clicca dentro: la tastiera è della pagina, finché l'avviso non la prende. Il fuoco
// lo chiede la prova, perché nella finestra di prova (fuori schermo, senza gestore di finestre) nessuno lo dà.
async function apriSenzaAspettare(app, shell, url) {
  const host = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const fine = Date.now() + 10_000;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } });
    if (p) {
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
        const tm = win._filoTabs;
        win.focus();
        tm.tabs.find((t) => t.id === tm.activeId).view.webContents.focus();
      });
      return p;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`nessuna scheda per ${url}`);
}

const MODULO_LENTO = '<title>Accedi</title><form><input name="email" placeholder="Email">'
  + '<input type="password" id="pw" name="pw" placeholder="Password"><button>Accedi</button></form>'
  + '<script src="/lento.js"></script><p>fine pagina</p>';

// Quello che si scrive dalla tastiera va all'avviso, e la pagina non ne riceve niente.
async function scriveNellAvviso(app, page, avviso) {
  await scriviDallaTastiera(app, 'segreto');
  await expect(avviso.getByPlaceholder('confermo')).toHaveValue('segreto');
  return page.locator('#pw').inputValue();
}

async function procedi(app, avviso) {
  await avviso.getByPlaceholder('confermo').fill('confermo');
  await avviso.getByRole('button', { name: 'Procedi comunque' }).click();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
}

test('pagina segnalata da Google che resta in caricamento: l\'avviso copre il modulo prima che finisca (#813.1)', async ({ app, shell }) => {
  await serviInCaricamento(app, { 'conto-verifica-accesso.com/login': MODULO_LENTO }, { gsbListed: true });
  try {
    const page = await apriSenzaAspettare(app, shell, 'https://conto-verifica-accesso.com/login');
    await expect(page.locator('#pw')).toBeVisible({ timeout: 8_000 });
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 6_000 });
    await expect.poll(() => copertura(app)).toEqual(COPERTA);
    expect(await page.evaluate(() => document.readyState)).toBe('loading');
    expect(await scriveNellAvviso(app, page, avviso)).toBe('');
    // Un verdetto ripetuto (a pagina pronta, dal main) non cancella quello che si sta scrivendo nell'avviso.
    await avviso.getByPlaceholder('confermo').fill('confer');
    await chiudiLenti(app);
    await page.waitForFunction(() => document.readyState !== 'loading', null, { timeout: 8_000 });
    await page.waitForTimeout(2000);
    await expect(avviso.getByPlaceholder('confermo')).toHaveValue('confer');
    expect(await copertura(app)).toEqual(COPERTA);
    await procedi(app, avviso);
    await page.locator('#pw').fill('segreto');
    await expect(page.locator('#pw')).toHaveValue('segreto');
  } finally {
    await chiudiLenti(app);
  }
});

test('campo password che compare mentre la pagina carica: l\'avviso che ne dipende non aspetta la fine (#813.1)', async ({ app, shell }) => {
  await serviInCaricamento(app, { 'area-riservata-clienti.it/accesso': MODULO_LENTO });
  try {
    const page = await apriSenzaAspettare(app, shell, 'http://area-riservata-clienti.it/accesso');
    await expect(page.locator('#pw')).toBeVisible({ timeout: 8_000 });
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText('Sito potenzialmente sospetto')).toBeVisible({ timeout: 6_000 });
    await expect.poll(() => copertura(app)).toEqual(COPERTA);
    expect(await page.evaluate(() => document.readyState)).toBe('loading');
  } finally {
    await chiudiLenti(app);
  }
});

test('verdetto pronto prima che la pagina mandi il primo byte: l\'avviso compare con la pagina e tiene la tastiera (#813.1)', async ({ app, shell }) => {
  await serviInCaricamento(app, { 'conto-verifica-accesso.com/login': MODULO_LENTO }, { gsbListed: true });
  try {
    const page = await apriSenzaAspettare(app, shell, 'https://conto-verifica-accesso.com/login?tardi');
    await expect(page.locator('#pw')).toBeVisible({ timeout: 8_000 });
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 6_000 });
    await expect.poll(() => copertura(app)).toEqual(COPERTA);
    expect(await page.evaluate(() => document.readyState)).toBe('loading');
    expect(await scriveNellAvviso(app, page, avviso)).toBe('');
  } finally {
    await chiudiLenti(app);
  }
});

// Sulle pagine ospitate il modulo sta in un riquadro: se il riquadro non finisce mai di caricarsi, l'avviso non lo aspetta.
for (const [nome, url, pagine] of [
  ['Google Sites: il riquadro col modulo', 'https://sites.google.com/view/posta-appesa', {
    'sites.google.com/view/posta-appesa': '<h1>Accesso alla posta</h1>'
      + '<iframe src="https://9999-atari-embeds.googleusercontent.com/embeds/x/user.html" width="500" height="300"></iframe>',
    '9999-atari-embeds.googleusercontent.com/embeds/x/user.html': `${ACCESSO}<script src="/lento.js"></script>`,
  }],
  ['Apps Script: il riquadro interno col modulo', 'https://script.google.com/macros/s/AKfyAppeso/exec', {
    'script.google.com/macros/s/AKfyAppeso/exec': '<iframe src="https://n-xyz-0lu-script.googleusercontent.com/panel" width="600" height="400"></iframe>',
    'n-xyz-0lu-script.googleusercontent.com/panel': '<iframe src="https://n-xyz-1lu-script.googleusercontent.com/user" width="580" height="380"></iframe>',
    'n-xyz-1lu-script.googleusercontent.com/user': `<h1>Microsoft 365</h1>${ACCESSO}<script src="/lento.js"></script>`,
  }],
]) {
  test(`${nome} che resta in caricamento fa comparire l'avviso (#813.1)`, async ({ app, shell }) => {
    await serviInCaricamento(app, pagine, { ospitate: true });
    try {
      await apriSenzaAspettare(app, shell, url);
      const avviso = await vistaAvviso(app, 10_000);
      await expect(avviso.getByText('Pagina pubblicata da un utente')).toBeVisible({ timeout: 10_000 });
      await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
    } finally {
      await chiudiLenti(app);
    }
  });
}

const MODULO = '<title>Accedi</title><form><input name="email" placeholder="Email">'
  + '<input type="password" id="pw" name="pw" placeholder="Password"><button>Accedi</button></form>';
// La pagina che ruba la password ascolta i tasti in tutto il documento.
const ASCOLTA = '<script>window.__k="";window.__i="";'
  + 'window.addEventListener("keydown",function(e){window.__k+=e.key},true);'
  + 'document.addEventListener("input",function(e){window.__i+=(e.data||"")},true);</script>';
const sentiti = (page) => page.evaluate(() => ({ k: window.__k, i: window.__i }));

test('la pagina segnalata si riprende il fuoco dopo l\'avviso: quello che si scrive resta nell\'avviso', async ({ app, shell }) => {
  await serviInCaricamento(app, { 'conto-verifica-fuoco.com/login': MODULO + ASCOLTA
    + '<script>setInterval(function(){window.focus();document.getElementById("pw").focus()},500)</script>' }, { gsbListed: true });
  const page = await apriSenzaAspettare(app, shell, 'https://conto-verifica-fuoco.com/login');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(2000);
  expect(await copertura(app)).toEqual(COPERTA);
  expect(await scriveNellAvviso(app, page, avviso)).toBe('');
  expect(await sentiti(page)).toEqual({ k: '', i: '' });
  // Esc non toglie l'avviso: si toglie solo dai suoi pulsanti.
  await scriviDallaTastiera(app, '\u001b\u001b');
  await page.waitForTimeout(300);
  expect((await copertura(app)).coperta).toBe(true);
  await procedi(app, avviso);
  await page.locator('#pw').fill('segreto');
  await expect(page.locator('#pw')).toHaveValue('segreto');
});

for (const quando of ['prima', 'dopo']) {
  test(`modulo in una modale della pagina aperta ${quando} dell'avviso: l'avviso resta sopra e risponde`, async ({ app, shell }) => {
    const apri = quando === 'prima' ? 'd.showModal()' : 'setTimeout(function(){d.showModal()},2000)';
    await serviInCaricamento(app, { [`conto-modale-${quando}.com/login`]: '<title>Accedi</title><dialog id="d"><form>'
      + '<input type="password" id="pw"></form></dialog><script>var d=document.getElementById("d");' + apri + '</script>' }, { gsbListed: true });
    const page = await apriSenzaAspettare(app, shell, `https://conto-modale-${quando}.com/login`);
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 8_000 });
    await page.waitForFunction(() => document.getElementById('d').open, null, { timeout: 6_000 });
    await page.waitForTimeout(300);
    expect(await copertura(app)).toEqual(COPERTA);
    expect(await scriveNellAvviso(app, page, avviso)).toBe('');
    await procedi(app, avviso);
    await page.locator('#pw').fill('segreto');
    await expect(page.locator('#pw')).toHaveValue('segreto');
  });
}

test('popup del sito sospetto: la pagina che si riprende il fuoco non riceve quello che si scrive', async ({ app, shell }) => {
  await serviInCaricamento(app, { 'area-riservata-fuoco.it/accesso': MODULO + ASCOLTA
    + '<script>setTimeout(function(){document.getElementById("pw").focus()},2000)</script>' });
  const page = await apriSenzaAspettare(app, shell, 'http://area-riservata-fuoco.it/accesso');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Sito potenzialmente sospetto')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(2800);
  expect(await copertura(app)).toEqual(COPERTA);
  await scriviDallaTastiera(app, 'segreto\r');
  expect((await copertura(app)).coperta).toBe(true);
  await expect(page.locator('#pw')).toHaveValue('');
  expect(await sentiti(page)).toEqual({ k: '', i: '' });
  await avviso.getByRole('button', { name: 'Continua' }).click();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  await page.locator('#pw').fill('segreto');
  await expect(page.locator('#pw')).toHaveValue('segreto');
});

// #813.5 — l'avviso sta fuori dalla pagina che avvisa: la pagina non sente quello che ci si scrive, non lo copre e
// non lo cancella.
test('la pagina in lista ascolta i tasti di tutto il documento: quello che si scrive nell\'avviso non le arriva', async ({ app, shell }) => {
  await serviInCaricamento(app, { 'conto-ascolta.com/login': MODULO + ASCOLTA + '<script src="/lento.js"></script>' }, { gsbListed: true });
  try {
    const page = await apriSenzaAspettare(app, shell, 'https://conto-ascolta.com/login');
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 8_000 });
    await expect.poll(() => copertura(app)).toEqual(COPERTA);
    await scriviDallaTastiera(app, 'segreto');
    await expect(avviso.getByPlaceholder('confermo')).toHaveValue('segreto');
    expect(await sentiti(page)).toEqual({ k: '', i: '' });
  } finally {
    await chiudiLenti(app);
  }
});

test('un riquadro a tutto schermo aperto dalla pagina non copre l\'avviso, e i tasti non le arrivano', async ({ app, shell }) => {
  await serviInCaricamento(app, { 'conto-popover.com/login': '<title>Accedi</title><div id="p" popover="manual" '
    + 'style="width:100vw;height:100vh;max-width:none;max-height:none;inset:0;margin:0;background:#fff">'
    + '<input type="password" id="pw" placeholder="Password"></div>' + ASCOLTA
    + '<script>setTimeout(function(){var p=document.getElementById("p");p.showPopover();document.getElementById("pw").focus()},2000)</script>' }, { gsbListed: true });
  const page = await apriSenzaAspettare(app, shell, 'https://conto-popover.com/login');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 8_000 });
  await page.waitForFunction(() => document.getElementById('p').matches(':popover-open'), null, { timeout: 6_000 });
  await page.waitForTimeout(500);
  expect(await copertura(app)).toEqual(COPERTA);
  expect(await scriveNellAvviso(app, page, avviso)).toBe('');
  expect(await sentiti(page)).toEqual({ k: '', i: '' });
});

for (const [nome, js] of [
  ['document.write', 'document.open();document.write(F);document.close();'],
  ['sostituzione dei figli di <html>', 'var b=document.createElement("body");b.innerHTML=F;document.documentElement.replaceChildren(document.head,b);'],
]) {
  test(`la pagina si riscrive a caricamento finito (${nome}): l'avviso resta e il campo password non si scrive`, async ({ app, shell }) => {
    const h = 'conto-riscrive-' + (nome.startsWith('document') ? 'a' : 'b') + '.com';
    await serviInCaricamento(app, { [h + '/login']: '<title>Attendere</title><p>Caricamento…</p><script>var F='
      + JSON.stringify(MODULO) + ';setTimeout(function(){' + js + '},2500)</script>' }, { gsbListed: true });
    const page = await apriSenzaAspettare(app, shell, 'https://' + h + '/login');
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 8_000 });
    await page.waitForFunction(() => !!document.getElementById('pw'), null, { timeout: 8_000 });
    await page.waitForTimeout(1500);
    expect(await copertura(app)).toEqual(COPERTA);
    await expect(avviso.getByText(SEGNALATO)).toBeVisible();
    expect(await scriveNellAvviso(app, page, avviso)).toBe('');
  });
}

test('i tasti del browser valgono anche dall\'avviso, che segue la scheda: Ctrl+T, il ritorno, Ctrl+W', async ({ app, shell }) => {
  await serviInCaricamento(app, { 'conto-schede.com/login': MODULO }, { gsbListed: true });
  await apriSenzaAspettare(app, shell, 'https://conto-schede.com/login');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  const schede = () => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { n: tm.tabs.length, attiva: tm.tabs.find((t) => t.id === tm.activeId).view.webContents.getURL() };
  });
  const prima = (await schede()).n;
  const tasto = (key, mod) => app.evaluate(({ webContents }, { key, mod }) => {
    const wc = webContents.getFocusedWebContents();
    wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: [mod] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: [mod] });
  }, { key, mod });
  await tasto('T', 'control');
  await expect.poll(async () => (await schede()).n).toBe(prima + 1);
  // Sulla scheda nuova l'avviso non c'è e la tastiera è sua.
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  await expect.poll(async () => (await copertura(app)).tastiera).toBe('pagina');
  // Tornati sulla scheda del sito, l'avviso la copre di nuovo e si riprende la tastiera.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((t) => /conto-schede/.test(t.view.webContents.getURL())).id);
  });
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  await tasto('W', 'control');
  await expect.poll(async () => (await schede()).n).toBe(prima);
  expect((await schede()).attiva).not.toContain('conto-schede');
  expect((await copertura(app)).coperta).toBe(false);
});

// Il menu di Filo si apre sopra l'avviso: chiedere a Filo del sito e segnalare il falso allarme si fanno in una scheda di
// Filo, lontano dalla pagina sotto l'avviso, che resta coperta.
async function menuDellAvviso(app, avviso) {
  await avviso.locator('#titolo').click({ button: 'right' });
  let menu = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try {
        if (!w.url().startsWith('data:text/html')) continue;
        if (await w.evaluate(() => [...document.querySelectorAll('button.item')].some((b) => /falso allarme/.test(b.textContent)))) { menu = w; return true; }
      } catch (_) {}
    }
    return false;
  }, { timeout: 8_000 }).toBe(true);
  return menu;
}

// La home aperta adesso, non quella che c'era già (la scheda d'avvio è anche lei una home).
async function homeNuova(app, prima) {
  let nuova = null;
  await expect.poll(() => {
    nuova = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab/') && !prima.includes(w); } catch (_) { return false; } });
    return !!nuova;
  }, { timeout: 10_000 }).toBe(true);
  return nuova;
}
const homeAperte = (app) => app.windows().filter((w) => { try { return w.url().startsWith('filo://newtab/'); } catch (_) { return false; } });

test('tasto destro sull\'avviso: il menu di Filo sta sopra e porta alla segnalazione e alla domanda a Filo', async ({ app, shell }) => {
  await serviInCaricamento(app, { 'conto-destro.com/login': MODULO }, { gsbListed: true });
  await apriSenzaAspettare(app, shell, 'https://conto-destro.com/login');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => copertura(app)).toEqual(COPERTA);

  let menu = await menuDellAvviso(app, avviso);
  expect(await menu.evaluate(() => [...document.querySelectorAll('button.item')].map((b) => b.textContent.trim())))
    .toEqual(['Chiedi a Filo di questo sito', 'Segnala un falso allarme', 'Copia l\'indirizzo', 'Torna indietro']);
  // Il menu è una finestra figlia, visibile, sopra la vista dell'avviso.
  expect(await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return BrowserWindow.getAllWindows().some((w) => w !== win && w.getParentWindow() === win && w.isVisible());
  })).toBe(true);

  let prima = homeAperte(app);
  await menu.evaluate(() => [...document.querySelectorAll('button.item')].find((b) => /falso allarme/.test(b.textContent)).click());
  const home = await homeNuova(app, prima);
  await expect(home.locator('.sn-fb-text')).toBeVisible({ timeout: 10_000 });
  await expect(home.locator('.sn-fb-text')).toHaveValue(/Falso allarme: Filo ha segnalato come pericoloso https:\/\/conto-destro\.com\/login/);
  await expect(home.locator('.sn-fb-text')).toHaveValue(new RegExp(SEGNALATO));
  // Chiusa senza inviare, la segnalazione resta come bozza.
  await expect.poll(() => home.evaluate(async () => (await chrome.storage.local.get(['sn_feedback_draft_text'])).sn_feedback_draft_text || ''))
    .toMatch(/Falso allarme/);

  // Tornati al sito, l'avviso è ancora lì e la pagina non ha la tastiera (il sistema, ridando il primo piano alla
  // finestra dopo il menu, la dà alla barra); dal suo menu la domanda a Filo parte da sola in una scheda nuova.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    tm.activate(tm.tabs.find((t) => /conto-destro/.test(t.view.webContents.getURL())).id);
    win.focus();
  });
  await expect.poll(async () => { const c = await copertura(app); return c.coperta && c.sopra && c.stessiBordi; }).toBe(true);
  expect((await copertura(app)).tastiera).not.toBe('pagina');
  prima = homeAperte(app);
  menu = await menuDellAvviso(app, avviso);
  await menu.evaluate(() => [...document.querySelectorAll('button.item')].find((b) => /Chiedi a Filo/.test(b.textContent)).click());
  const chat = await homeNuova(app, prima);
  await expect(chat.locator('.dash-bubble-user')).toContainText('https://conto-destro.com/login', { timeout: 10_000 });
  await expect(chat.locator('.dash-bubble-user')).toContainText('È davvero da evitare?');
  // La richiesta vale una volta: ricaricata, la home non rimanda la domanda.
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs
    .filter((t) => t._richiestaCasa).length)).toBe(0);
});

test('Alt+H sull\'avviso: l\'Aiuto, che starebbe sotto l\'avviso, diventa la domanda a Filo sul sito', async ({ app, shell }) => {
  await serviInCaricamento(app, { 'conto-aiuto.com/login': MODULO }, { gsbListed: true });
  await apriSenzaAspettare(app, shell, 'https://conto-aiuto.com/login');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  const prima = homeAperte(app);
  await app.evaluate(({ webContents }) => {
    const wc = webContents.getFocusedWebContents();
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['alt'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['alt'] });
  });
  const chat = await homeNuova(app, prima);
  await expect(chat.locator('.dash-bubble-user')).toContainText('https://conto-aiuto.com/login', { timeout: 10_000 });
});

// Il sito in lista vale anche nei documenti che crea da sé: una copia blob, una finestrella di accesso.
const BLOB_MODULO = MODULO + '<script>window.__k="";addEventListener("keydown",function(e){window.__k+=e.key},true);'
  + 'setTimeout(function(){document.getElementById("pw").focus()},300)<\/script>';
const nelBlob = (app) => app.windows().find((w) => { try { return w.url().startsWith('blob:'); } catch (_) { return false; } });
const urlAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.find((t) => t.id === tm.activeId).view.webContents.getURL();
});

for (const [dove, js] of [['nella stessa scheda', 'location.href=u'], ['in una scheda nuova', 'window.open(u)']]) {
  test(`la pagina in lista si riscrive in una sua copia blob (${dove}): l'avviso resta e i tasti non le arrivano`, async ({ app, shell }) => {
    const h = `conto-blob-${js.length}.com`;
    await serviInCaricamento(app, { [h + '/login']: '<title>Attendere</title><p>Caricamento…</p><script>var F='
      + JSON.stringify(BLOB_MODULO).replace(/<\//g, '<\\/')
      + ';setTimeout(function(){var u=URL.createObjectURL(new Blob([F],{type:"text/html"}));' + js + '},2500)</script>' }, { gsbListed: true });
    await apriSenzaAspettare(app, shell, `https://${h}/login`);
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 8_000 });
    await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toMatch(/^blob:/);
    await expect(avviso.getByText(SEGNALATO)).toBeVisible();
    await expect.poll(() => copertura(app)).toEqual(COPERTA);
    await scriviDallaTastiera(app, 'segreto');
    await expect(avviso.getByPlaceholder('confermo')).toHaveValue('segreto');
    expect(await nelBlob(app).evaluate(() => ({ k: window.__k, pw: document.getElementById('pw').value }))).toEqual({ k: '', pw: '' });
  });
}

const finestreFuoriDaFilo = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((w) => !w._filoTabs && !w.isDestroyed() && w.isVisible() && /^https?:/.test(w.webContents.getURL())).map((w) => w.webContents.getURL()));

test('la pagina in lista apre da sola una finestrella di accesso del suo sito: diventa una scheda sotto l\'avviso', async ({ app, shell }) => {
  const h = 'conto-finestrella.com';
  await serviInCaricamento(app, {
    [h + '/login']: '<title>Attendere</title><p>Caricamento…</p><script>setTimeout(function(){'
      + `window.open("https://${h}/oauth/authorize?client_id=1&redirect_uri=x","p","width=500,height=600")},2500)</script>`,
    [h + '/oauth/authorize']: BLOB_MODULO,
  }, { gsbListed: true });
  await apriSenzaAspettare(app, shell, `https://${h}/login`);
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toContain(`${h}/oauth/authorize`);
  expect(await finestreFuoriDaFilo(app)).toEqual([]);
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  await scriviDallaTastiera(app, 'segreto');
  await expect(avviso.getByPlaceholder('confermo')).toHaveValue('segreto');
  const accesso = app.windows().find((w) => { try { return w.url().includes('/oauth/authorize'); } catch (_) { return false; } });
  expect(await accesso.evaluate(() => ({ k: window.__k, pw: document.getElementById('pw').value }))).toEqual({ k: '', pw: '' });
});

test('una finestrella di accesso che apre un sito in lista torna in una scheda, sotto l\'avviso', async ({ app, shell }) => {
  const h = 'conto-in-finestrella.com';
  await serviInCaricamento(app, {
    'pagina-con-accesso.it/': '<title>Negozio</title><script>setTimeout(function(){'
      + `window.open("https://${h}/oauth/authorize?client_id=1&redirect_uri=x","p","width=500,height=600")},1000)</script>`,
    [h + '/oauth/authorize']: BLOB_MODULO,
  });
  await app.evaluate((_e, host) => {
    globalThis.SN_SAFEBROWSE.setProviders({
      gsb: async (url, norm) => (norm.host === host ? { listed: true, category: 'phishing' } : null),
      rdap: null, ct: null, sandbox: null, llm: async () => ({ suspicious: false, reason: null }),
    });
  }, h);
  await apriSenzaAspettare(app, shell, 'https://pagina-con-accesso.it/');
  const avviso = await vistaAvviso(app, 12_000);
  await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => urlAttiva(app)).toContain(`${h}/oauth/authorize`);
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  expect(await finestreFuoriDaFilo(app)).toEqual([]);
});

// La finestrella aperta prima del verdetto segue la scheda che l'ha aperta, anche se poi il sito la riscrive.
async function gsbInRitardo(app, host, ms) {
  await app.evaluate((_e, { host, ms }) => {
    globalThis.SN_SAFEBROWSE.setProviders({
      gsb: async (url, norm) => { await new Promise((r) => setTimeout(r, ms)); return norm.host === host ? { listed: true, category: 'phishing' } : null; },
      rdap: null, ct: null, sandbox: null, llm: async () => ({ suspicious: false, reason: null }),
    });
  }, { host, ms });
}

test('finestrella aperta prima del verdetto e poi riscritta dal sito in lista in una pagina vuota: torna in una scheda, sotto l\'avviso', async ({ app, shell }) => {
  const h = 'conto-vuota.com';
  const idp = 'accesso-esempio.org';
  await serviInCaricamento(app, {
    [h + '/login']: '<title>Attendere</title><p>Caricamento…</p><script>var F=' + JSON.stringify(BLOB_MODULO).replace(/<\//g, '<\\/')
      + `;if(!localStorage.aperta){localStorage.aperta=1;var p=window.open("https://${idp}/oauth/authorize?client_id=1&redirect_uri=x","p","width=500,height=600");`
      + 'setTimeout(function(){p.location="about:blank";setTimeout(function(){p.document.open();p.document.write(F);p.document.close()},700)},3000)}</script>',
    [idp + '/oauth/authorize']: '<title>Accedi con</title><p>Accesso</p>',
  });
  await gsbInRitardo(app, h, 800);
  await apriSenzaAspettare(app, shell, `https://${h}/login`);
  await expect.poll(() => finestreFuoriDaFilo(app), { timeout: 8_000 }).toEqual([expect.stringContaining(idp)]);
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => !w._filoTabs && !w.isDestroyed() && w.isVisible() && w.webContents.getType() === 'window').length)), { timeout: 8_000 }).toBe(0);
  await expect.poll(() => urlAttiva(app)).toContain(`${h}/login`);
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  await scriviDallaTastiera(app, 'segreto');
  await expect(avviso.getByPlaceholder('confermo')).toHaveValue('segreto');
});

test('finestrella del sito in lista che cambia indirizzo sul posto prima del verdetto: torna in una scheda, sotto l\'avviso', async ({ app, shell }) => {
  const h = 'conto-sposta.com';
  await serviInCaricamento(app, {
    [h + '/login']: `<title>Attendere</title><p>Caricamento…</p><script>if(!localStorage.aperta){localStorage.aperta=1;window.open("https://${h}/oauth/authorize?client_id=1&redirect_uri=x","p","width=500,height=600")}</script>`,
    [h + '/oauth/authorize']: BLOB_MODULO + '<script>var i=0;setInterval(function(){history.replaceState(null,"",'
      + 'location.pathname+"?client_id=1&redirect_uri=x&t="+(++i))},150)</script>',
  });
  await gsbInRitardo(app, h, 1500);
  await apriSenzaAspettare(app, shell, `https://${h}/login`);
  const avviso = await vistaAvviso(app, 12_000);
  await expect(avviso.getByText(SEGNALATO)).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => finestreFuoriDaFilo(app), { timeout: 8_000 }).toEqual([]);
  await expect.poll(() => urlAttiva(app)).toContain(`${h}/oauth/authorize`);
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  await scriviDallaTastiera(app, 'segreto');
  await expect(avviso.getByPlaceholder('confermo')).toHaveValue('segreto');
  const accesso = app.windows().find((w) => { try { return w.url().includes('/oauth/authorize'); } catch (_) { return false; } });
  expect(await accesso.evaluate(() => ({ k: window.__k, pw: document.getElementById('pw').value }))).toEqual({ k: '', pw: '' });
});

test('parola comune vicina a un marchio: avviso richiudibile, non il blocco a pagina piena (#728)', async ({ app, openTab }) => {
  // team.com dista una lettera da "steam": prima l'utente trovava il blocco che si toglie solo scrivendo "confermo".
  await servi(app, { 'team.com': '<title>SB_PAROLA_COMUNE</title><h1>Team</h1><p>contenuto della pagina</p>' });
  const page = await openTab('https://team.com/');
  const avviso = await vistaAvviso(app, 12_000);
  const continua = avviso.getByRole('button', { name: 'Continua' });
  await expect(continua).toBeVisible({ timeout: 12_000 });
  await expect(avviso.getByRole('button', { name: 'Procedi comunque' })).toHaveCount(0);
  await expect(avviso.getByText(/assomiglia all'indirizzo di Steam/)).toBeVisible();

  // Un clic e l'utente è sulla pagina che voleva.
  await continua.click();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
});

// #728 — un sosia di un marchio corto blocca solo se chiede la password: il campo va visto anche quando arriva dopo
// il caricamento o sta in un riquadro. Niente rete: conta solo il nome, come con un dominio vecchio.
async function serviSenzaRete(app, pagine) {
  await servi(app, pagine);
  await app.evaluate(() => globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null }));
}

async function bloccoMostrato(app) {
  const avviso = await vistaAvviso(app, 12_000);
  await expect(avviso.getByPlaceholder('confermo')).toBeVisible({ timeout: 10_000 });
  // La tastiera non si guarda: openTab non porta la finestra in primo piano.
  await expect.poll(async () => { const c = await copertura(app); return c.coperta && c.sopra; }).toBe(true);
  return avviso;
}

test('sosia di un marchio corto: il modulo d\'accesso montato dopo l\'apertura porta al blocco (#728)', async ({ app, openTab }) => {
  await serviSenzaRete(app, {
    'paypak.com': '<h1>PayPal</h1><div id="app">Caricamento…</div><script>'
      + `setTimeout(() => { document.getElementById('app').innerHTML = ${JSON.stringify(ACCESSO)}; }, 2500);</script>`,
  });
  await openTab('https://paypak.com/');
  const avviso = await vistaAvviso(app, 12_000);
  await expect(avviso.getByRole('button', { name: 'Continua' })).toBeVisible({ timeout: 12_000 });
  await bloccoMostrato(app);
  await expect(avviso.getByText(/ti sta chiedendo la password/)).toBeVisible();
});

test('sosia di un marchio corto: la password chiesta dopo l\'email, senza ricaricare, porta al blocco (#728)', async ({ app, openTab }) => {
  await serviSenzaRete(app, {
    'paypak.com': '<h1>PayPal</h1><div id="f"><input name="email" placeholder="Email">'
      + '<button id="avanti" onclick="document.getElementById(\'f\').innerHTML = '
      + '\'<input type=password placeholder=Password><button>Accedi</button>\'">Avanti</button></div>',
  });
  const page = await openTab('https://paypak.com/');
  const avviso = await vistaAvviso(app, 12_000);
  const continua = avviso.getByRole('button', { name: 'Continua' });
  await expect(continua).toBeVisible({ timeout: 12_000 });
  await continua.click();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  await page.getByPlaceholder('Email').fill('mario@example.com');
  await page.waitForTimeout(3000);
  await page.click('#avanti');
  await bloccoMostrato(app);
});

test('sosia di un marchio corto col modulo d\'accesso in un riquadro della pagina: blocco (#728)', async ({ app, openTab }) => {
  await serviSenzaRete(app, {
    'paypak.com/accesso': `<!doctype html><body>${ACCESSO}</body>`,
    'paypak.com': '<h1>PayPal</h1><iframe src="/accesso" width="400" height="200"></iframe>',
  });
  const page = await openTab('https://paypak.com/');
  await expect(page.frameLocator('iframe').getByPlaceholder('Email')).toBeVisible({ timeout: 12_000 });
  await bloccoMostrato(app);
});

test('il blocco già a schermo non si ridisegna quando un\'altra analisi lo rimanda: il «confermo» a metà resta (#728)', async ({ app, openTab }) => {
  await serviSenzaRete(app, { 'paypak.com': `<h1>PayPal</h1>${ACCESSO}` });
  await openTab('https://paypak.com/');
  const avviso = await bloccoMostrato(app);
  const campo = avviso.getByPlaceholder('confermo');
  await campo.fill('conf');
  // Il giro sui campi della pagina parte dopo il caricamento e rimanda lo stesso verdetto.
  await new Promise((r) => setTimeout(r, 3000));
  await expect(campo).toHaveValue('conf');
});

// #728 — conta il campo a schermo: un modulo d'accesso tenuto nascosto dietro «Accedi» non fa del sito vero un sosia.
test('parola comune vicina a un marchio col modulo d\'accesso nascosto: popup, non il blocco (#728)', async ({ app, openTab }) => {
  await serviSenzaRete(app, {
    'email.com': '<h1>Posta gratuita</h1><button onclick="document.getElementById(\'m\').hidden=false">Accedi</button>'
      + `<div id="m" hidden>${ACCESSO}</div>`,
  });
  await openTab('https://email.com/');
  const avviso = await vistaAvviso(app, 12_000);
  await expect(avviso.getByRole('button', { name: 'Continua' })).toBeVisible({ timeout: 12_000 });
  // Più di un giro sui campi della pagina.
  await new Promise((r) => setTimeout(r, 4000));
  await expect(avviso.getByPlaceholder('confermo')).toBeHidden();
});

test('sosia di un marchio corto: il modulo nascosto che si apre dopo «Continua» porta al blocco (#728)', async ({ app, openTab }) => {
  await serviSenzaRete(app, {
    'paypak.com': '<h1>PayPal</h1><button id="apri" onclick="document.getElementById(\'m\').hidden=false">Accedi</button>'
      + `<div id="m" hidden>${ACCESSO}</div>`,
  });
  const page = await openTab('https://paypak.com/');
  const avviso = await vistaAvviso(app, 12_000);
  const continua = avviso.getByRole('button', { name: 'Continua' });
  await expect(continua).toBeVisible({ timeout: 12_000 });
  await continua.click();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  await page.click('#apri');
  await bloccoMostrato(app);
});

test('sosia di un marchio corto col modulo d\'accesso in un componente incapsulato (shadow DOM): blocco (#728)', async ({ app, openTab }) => {
  await serviSenzaRete(app, {
    'paypak.com': '<h1>PayPal</h1><login-box></login-box><script>customElements.define("login-box", class extends HTMLElement {'
      + `constructor(){super(); this.attachShadow({mode:"open"}).innerHTML = ${JSON.stringify(ACCESSO)};}});</script>`,
  });
  await openTab('https://paypak.com/');
  await bloccoMostrato(app);
});

// #728 — a schermo è ciò che l'utente vede: un modulo nascosto dal riquadro che lo contiene (trasparente, chiuso,
// fuori dal bordo) non conta; lo stesso modulo, aperto, sì.
const NASCOSTI_728 = {
  'menu a tendina trasparente': ['<style>.m{opacity:0;pointer-events:none;position:absolute;top:40px;right:0}.m.su{opacity:1}</style>', 'm'],
  'pannello chiuso': ['<style>.m{max-height:0;overflow:hidden}.m.su{max-height:none}</style>', 'm'],
  'cassetto laterale fuori schermo': ['<style>body{overflow-x:hidden}.m{position:fixed;top:0;right:0;width:300px;height:100%;'
    + 'transform:translateX(100%)}.m.su{transform:none}</style>', 'm'],
};
const conModulo = (stile, titolo) => `${stile}<h1>${titolo}</h1><button id="apri" onclick="document.querySelector('.m').classList.add('su')">Accedi</button>`
  + `<div class="m">${ACCESSO}</div>`;

for (const [modo, [stile]] of Object.entries(NASCOSTI_728)) {
  test(`parola comune vicina a un marchio, modulo d'accesso nascosto (${modo}): popup, non il blocco (#728)`, async ({ app, openTab }) => {
    await serviSenzaRete(app, { 'email.com': conModulo(stile, 'Posta gratuita') });
    await openTab('https://email.com/');
    expect(await livelloScheda(app, 'email.com', 12_000)).toBe('sospetto');
    await new Promise((r) => setTimeout(r, 4500));
    expect(await livelloScheda(app, 'email.com', 1000)).toBe('sospetto');
  });

  test(`sosia di un marchio corto, modulo d'accesso nascosto (${modo}) che si apre: blocco (#728)`, async ({ app, openTab }) => {
    await serviSenzaRete(app, { 'paypak.com': conModulo(stile, 'PayPal') });
    const page = await openTab('https://paypak.com/');
    expect(await livelloScheda(app, 'paypak.com', 12_000)).toBe('sospetto');
    await page.evaluate(() => document.querySelector('.m').classList.add('su'));
    await expect.poll(() => livelloScheda(app, 'paypak.com', 1000), { timeout: 10_000 }).toBe('pericoloso');
  });
}

test('sosia di un marchio corto, modulo in una tendina che esce da una testata che ritaglia: blocco (#728)', async ({ app, openTab }) => {
  await serviSenzaRete(app, {
    'paypak.com': '<style>header{height:40px;overflow:hidden}.m{position:absolute;top:40px;left:0}</style>'
      + `<header><h1>PayPal</h1><div class="m">${ACCESSO}</div></header>`,
  });
  await openTab('https://paypak.com/');
  await expect.poll(() => livelloScheda(app, 'paypak.com', 1000), { timeout: 12_000 }).toBe('pericoloso');
});

test('sosia di un marchio corto col modulo d\'accesso in un componente incapsulato chiuso: blocco (#728)', async ({ app, openTab }) => {
  await serviSenzaRete(app, {
    'paypak.com': '<h1>PayPal</h1><login-box></login-box><script>customElements.define("login-box", class extends HTMLElement {'
      + `constructor(){super(); this.attachShadow({mode:"closed"}).innerHTML = ${JSON.stringify(ACCESSO)};}});</script>`,
  });
  await openTab('https://paypak.com/');
  await expect.poll(() => livelloScheda(app, 'paypak.com', 1000), { timeout: 12_000 }).toBe('pericoloso');
});

// #728 — a schermo lo dice il motore, non un elenco di trucchi: un ritaglio di qualunque forma, o la pagina che nasconde
// il riquadro col modulo (dello stesso sito o di un altro), lasciano il sito vero al popup.
const NASCOSTI_DAL_MOTORE_728 = {
  'tendina ritagliata (clip-path)': `<div style="clip-path:inset(0 0 100% 0);position:absolute;top:60px;right:0">${ACCESSO}</div>`,
  'riquadro dello stesso sito in una tendina trasparente':
    '<div style="opacity:0;position:absolute;top:60px;right:0"><iframe src="/login" width="400" height="200"></iframe></div>',
  'riquadro di un altro sito in una tendina trasparente':
    '<div style="opacity:0;position:absolute;top:60px;right:0"><iframe src="https://accesso-posta.net/login" width="400" height="200"></iframe></div>',
};
for (const [modo, corpo] of Object.entries(NASCOSTI_DAL_MOTORE_728)) {
  test(`parola comune vicina a un marchio, modulo d'accesso nascosto (${modo}): popup, non il blocco (#728)`, async ({ app, openTab }) => {
    await serviSenzaRete(app, {
      'email.com/login': `<!doctype html><body>${ACCESSO}</body>`,
      'accesso-posta.net/login': `<!doctype html><body>${ACCESSO}</body>`,
      'email.com': `<h1>Posta gratuita</h1><button>Accedi</button>${corpo}`,
    });
    await openTab('https://email.com/');
    expect(await livelloScheda(app, 'email.com', 12_000)).toBe('sospetto');
    await new Promise((r) => setTimeout(r, 5000));
    expect(await livelloScheda(app, 'email.com', 1000)).toBe('sospetto');
  });
}

test('sosia di un marchio corto col modulo d\'accesso nel riquadro di un altro sito, a schermo: blocco (#728)', async ({ app, openTab }) => {
  await serviSenzaRete(app, {
    'accesso-posta.net/login': `<!doctype html><body>${ACCESSO}</body>`,
    'paypak.com': '<h1>PayPal</h1><iframe src="https://accesso-posta.net/login" width="400" height="200"></iframe>',
  });
  await openTab('https://paypak.com/');
  await expect.poll(() => livelloScheda(app, 'paypak.com', 1000), { timeout: 12_000 }).toBe('pericoloso');
});

const CHIUSI_728 = {
  'scritto nell\'HTML': `<div><template shadowrootmode="closed">${ACCESSO}</template></div>`,
  'dentro un riquadro della pagina': '<iframe src="/inner" width="400" height="200"></iframe>',
};
for (const [modo, corpo] of Object.entries(CHIUSI_728)) {
  test(`sosia di un marchio corto col modulo in un componente chiuso ${modo}: blocco (#728)`, async ({ app, openTab }) => {
    await serviSenzaRete(app, {
      'paypak.com/inner': '<!doctype html><body><div id="h"></div><script>document.getElementById("h")'
        + `.attachShadow({mode:"closed"}).innerHTML = ${JSON.stringify(ACCESSO)};</script></body>`,
      'paypak.com': `<h1>PayPal</h1>${corpo}`,
    });
    await openTab('https://paypak.com/');
    await expect.poll(() => livelloScheda(app, 'paypak.com', 1000), { timeout: 12_000 }).toBe('pericoloso');
  });
}

test('i componenti chiusi di una pagina restano chiusi ai suoi script: Filo non li espone (#728)', async ({ app, openTab }) => {
  await serviSenzaRete(app, {
    'esempio-negozio.com': '<div id="h"></div><script>document.getElementById("h").attachShadow({mode:"closed"})'
      + '.innerHTML = "<input id=segreto value=123>";</script>',
  });
  const page = await openTab('https://esempio-negozio.com/');
  await page.waitForLoadState('load');
  const letto = await page.evaluate(() => {
    const cerca = (lista) => { for (const r of lista || []) { try { const el = r.querySelector('#segreto'); if (el) return el.value; } catch (_) {} } return null; };
    for (const k of [...Object.getOwnPropertySymbols(window), ...Object.getOwnPropertyNames(window)]) {
      try { const v = window[k]; if (Array.isArray(v) || (v && typeof v[Symbol.iterator] === 'function' && typeof v !== 'string')) { const x = cerca(v); if (x) return x; } } catch (_) {}
    }
    return null;
  });
  expect(letto).toBeNull();
});
