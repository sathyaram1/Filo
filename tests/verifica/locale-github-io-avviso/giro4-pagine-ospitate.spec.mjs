// Giro 4 della verifica «avviso GitHub su github.io»: le porte del giro 3 riprovate in Filo con pagine servite sotto
// gli indirizzi veri, più le strade vicine: moduli che compaiono molto dopo, carta in altre forme, costo del giudice.
import { test, expect } from '../../fixtures/electron.mjs';

const tabLevel = (app, host) => app.evaluate(({ BrowserWindow }, h) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w._filoTabs) continue;
    for (const t of w._filoTabs.tabs) {
      let u = '';
      try { u = new URL(t.view.webContents.getURL()).hostname; } catch (_) {}
      if (u === h) return t.sbLevel || null;
    }
  }
  return null;
}, host);

// Giudice AI sostituito da uno che fa quello che il suo prompt chiede; conta le chiamate per misurare il costo.
async function preparaRete(app, pagine) {
  await app.evaluate(async ({ session, net }, pg) => {
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname] || pg[u.hostname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    });
    globalThis.__chiamateGiudice = 0;
    globalThis.SN_SAFEBROWSE.setProviders({
      sandbox: null,
      llm: async (meta) => {
        globalThis.__chiamateGiudice++;
        const sosp = !!meta.hostedOn && (meta.hasPassword || meta.hasPayment);
        return sosp ? { suspicious: true, reasonKey: 'hosted_credentials', reason: 'pagina ospitata che chiede credenziali', confidence: 'high' }
          : { suspicious: false, reason: null };
      },
    });
  }, pagine);
}

async function livelloDopo(app, host, ms = 9000) {
  const fine = Date.now() + ms;
  let l = null;
  while (Date.now() < fine) {
    l = await tabLevel(app, host);
    if (l === 'sospetto' || l === 'pericoloso') return l;
    await new Promise((r) => setTimeout(r, 300));
  }
  return l;
}

const chiudiSchede = (app, host) => app.evaluate(({ BrowserWindow }, h) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w._filoTabs) continue;
    for (const t of [...w._filoTabs.tabs]) {
      try { if (new URL(t.view.webContents.getURL()).hostname === h) t.view.webContents.close(); } catch (_) {}
    }
  }
}, host);

const MODULO = '<form><input name="email" placeholder="Email"><input type="password" name="pw"><button>Accedi</button></form>';
const domandaGoogle = (id, titolo) => `<div role="listitem"><div id="${id}" role="heading" aria-level="3">`
  + `<span>${titolo}</span></div><input type="text" class="whsOnd" autocomplete="off" aria-labelledby="${id} ${id}x">`
  + `<div id="${id}x">La tua risposta</div></div>`;
const moduloGoogle = (titolo, domande) => `<html><body><h1>${titolo}</h1><form>`
  + domande.map((d, i) => domandaGoogle('i' + i, d)).join('') + '<button>Invia</button></form></body></html>';

test('porta del giro 3: Modulo Google con i dati della carta in campi di testo', async ({ app, openTab }) => {
  await preparaRete(app, { 'docs.google.com/forms/d/e/1FAIpQLcarta/viewform': moduloGoogle('Rimborso Amazon: conferma la carta',
    ['Numero della carta di credito', 'Scadenza', 'CVV']) });
  await openTab('https://docs.google.com/forms/d/e/1FAIpQLcarta/viewform');
  expect(await livelloDopo(app, 'docs.google.com')).toBe('sospetto');
});

test('porta del giro 3: Microsoft Forms con la password nella seconda sezione', async ({ app, openTab }) => {
  await preparaRete(app, {
    'forms.cloud.microsoft/r/Sez2': '<html><body><div id="form">'
      + '<span id="QuestionId_r1"><span>Email aziendale</span></span>'
      + '<input data-automation-id="textInput" aria-labelledby="QuestionId_r1">'
      + '<button id="avanti" onclick="document.getElementById(\'form\').innerHTML = '
      + '\'<span id=QuestionId_r2><span>Password</span></span><input data-automation-id=textInput aria-labelledby=QuestionId_r2>\'">'
      + 'Avanti</button></div></body></html>',
  });
  const page = await openTab('https://forms.cloud.microsoft/r/Sez2');
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(3000);
  await page.click('#avanti');
  expect(await livelloDopo(app, 'forms.cloud.microsoft')).toBe('sospetto');
});

test('porta del giro 3: Google Sites con il modulo montato quattro secondi dopo il riquadro', async ({ app, openTab }) => {
  await preparaRete(app, {
    'sites.google.com/view/posta-lenta': '<html><body><h1>Accesso alla posta</h1>'
      + '<iframe src="https://5678-atari-embeds.googleusercontent.com/embeds/x/user.html" width="500" height="300"></iframe></body></html>',
    '5678-atari-embeds.googleusercontent.com/embeds/x/user.html': '<html><body><p>Caricamento…</p><script>'
      + `setTimeout(() => { document.body.innerHTML = ${JSON.stringify(MODULO)}; }, 4000);</script></body></html>`,
  });
  await openTab('https://sites.google.com/view/posta-lenta');
  expect(await livelloDopo(app, 'sites.google.com', 12000)).toBe('sospetto');
});

test('porta del giro 3: Apps Script aziendale e Cognito regionale', async ({ app, openTab }) => {
  await preparaRete(app, {
    'script.google.com/a/macros/contoso.com/s/AKfy999/exec': '<html><body>'
      + '<iframe src="https://n-def456-0lu-script.googleusercontent.com/userCodeAppPanel" width="600" height="400"></iframe></body></html>',
    'n-def456-0lu-script.googleusercontent.com': `<html><body><h1>Microsoft 365</h1>${MODULO}</body></html>`,
  });
  await openTab('https://script.google.com/a/macros/contoso.com/s/AKfy999/exec');
  expect(await livelloDopo(app, 'script.google.com')).toBe('sospetto');
  const cognito = await app.evaluate(() => globalThis.SN_SAFEBROWSE.checkSync('https://paypal-login.auth.us-east-1.amazoncognito.com/login', {}).level);
  expect(cognito).toBe('sospetto');
});

test('la domanda della password compare dopo venti secondi in un Modulo Google: l\'avviso compare lo stesso', async ({ app, openTab }) => {
  await preparaRete(app, {
    'docs.google.com/forms/d/e/1FAIpQLtardi/viewform': '<html><body><h1>Verifica casella</h1><div id="f">Caricamento…</div><script>'
      + `setTimeout(() => { document.getElementById('f').innerHTML = ${JSON.stringify(domandaGoogle('i1', 'Password della posta'))}; }, 20000);`
      + '</script></body></html>',
  });
  await openTab('https://docs.google.com/forms/d/e/1FAIpQLtardi/viewform');
  expect(await livelloDopo(app, 'docs.google.com', 32000)).toBe('sospetto');
});

test('dati della carta e credenziali scritti in altre forme e lingue in un Modulo Google', async ({ app, openTab }) => {
  const casi = {
    'docs.google.com/forms/d/e/c1/viewform': moduloGoogle('Rimborso', ['Card number', 'Expiry date', 'Security code']),
    'docs.google.com/forms/d/e/c2/viewform': moduloGoogle('Rimborso', ['Numero carta', 'Data di scadenza', 'Codice di sicurezza (3 cifre sul retro)']),
    'docs.google.com/forms/d/e/c3/viewform': moduloGoogle('Accesso', ['Utente', 'PIN del bancomat']),
    'docs.google.com/forms/d/e/c5/viewform': moduloGoogle('Connexion', ['Adresse e-mail', 'Mot de passe']),
    'docs.google.com/forms/d/e/c6/viewform': moduloGoogle('Anmeldung', ['E-Mail', 'Passwort']),
    'docs.google.com/forms/d/e/c7/viewform': moduloGoogle('Acceso', ['Correo', 'Contraseña']),
    'docs.google.com/forms/d/e/c8/viewform': moduloGoogle('Accesso', ['Email', 'PASSWORD']),
  };
  await preparaRete(app, casi);
  const esiti = {};
  for (const p of Object.keys(casi)) {
    await openTab('https://' + p);
    esiti[p] = await livelloDopo(app, 'docs.google.com', 8000);
    await chiudiSchede(app, 'docs.google.com');
    await new Promise((r) => setTimeout(r, 800));
  }
  expect(esiti).toEqual(Object.fromEntries(Object.keys(casi).map((p) => [p, 'sospetto'])));
});

test('una pagina ospitata che cambia di continuo non chiama il giudice AI a ripetizione', async ({ app, openTab }) => {
  await preparaRete(app, {
    'docs.google.com/forms/d/e/muta/viewform': '<html><body><h1>Sondaggio</h1><form>' + domandaGoogle('i1', 'Password')
      + '</form><div id="t"></div><script>let n = 0; setInterval(() => { n++; document.getElementById("t").textContent = "tick " + n;'
      + ' const d = document.createElement("div"); d.innerHTML = \'<label>Domanda \' + n + \'</label><input type="text">\';'
      + ' document.body.appendChild(d); }, 150);</script></body></html>',
  });
  await openTab('https://docs.google.com/forms/d/e/muta/viewform');
  await new Promise((r) => setTimeout(r, 20000));
  const n = await app.evaluate(() => globalThis.__chiamateGiudice);
  expect(n).toBeLessThanOrEqual(3);
});
