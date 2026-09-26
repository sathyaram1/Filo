// Giro 3 della verifica «avviso GitHub su github.io»: le porte del giro 2 riprovate in Filo con pagine servite sotto
// gli indirizzi veri delle piattaforme, più le strade nuove: dati di carta in un modulo, domande che compaiono dopo.
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

// Il giudice AI è sostituito da uno che fa quello che il suo prompt chiede: sospetta una pagina ospitata che chiede
// password o pagamento. Le pagine si servono intercettando https nella sessione delle schede.
async function preparaRete(app, pagine) {
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
      llm: async (meta) => {
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

const MODULO = '<form><input name="email" placeholder="Email"><input type="password" name="pw"><button>Accedi</button></form>';

// Domanda di un Modulo Google com'è fatta: il titolo sta in un div, il campo lo cita per id.
const domandaGoogle = (id, titolo) => `<div role="listitem"><div id="${id}" role="heading" aria-level="3">`
  + `<span>${titolo}</span></div><input type="text" class="whsOnd" autocomplete="off" aria-labelledby="${id} ${id}x">`
  + `<div id="${id}x">La tua risposta</div></div>`;

test('porta del giro 2, Google Sites: il modulo con la password in un riquadro incorporato fa comparire l\'avviso', async ({ app, openTab }) => {
  await preparaRete(app, {
    'sites.google.com/view/paypal-login': '<html><body><h1>PayPal - Accedi</h1>'
      + '<iframe src="https://1234-atari-embeds.googleusercontent.com/embeds/abc/inner-frame-minified.html" width="500" height="300"></iframe></body></html>',
    '1234-atari-embeds.googleusercontent.com/embeds/abc/inner-frame-minified.html':
      '<html><body><iframe src="https://1234-atari-embeds.googleusercontent.com/embeds/abc/user.html"></iframe></body></html>',
    '1234-atari-embeds.googleusercontent.com/embeds/abc/user.html': `<html><body>${MODULO}</body></html>`,
  });
  await openTab('https://sites.google.com/view/paypal-login');
  expect(await livelloDopo(app, 'sites.google.com')).toBe('sospetto');
});

test('porta del giro 2, Apps Script: la pagina dell\'utente in un riquadro fa comparire l\'avviso', async ({ app, openTab }) => {
  await preparaRete(app, {
    'script.google.com/macros/s/AKfy123/exec': '<html><body>'
      + '<iframe src="https://n-abc123-0lu-script.googleusercontent.com/userCodeAppPanel" width="600" height="400"></iframe></body></html>',
    'n-abc123-0lu-script.googleusercontent.com': `<html><body><h1>Microsoft 365</h1>${MODULO}</body></html>`,
  });
  await openTab('https://script.google.com/macros/s/AKfy123/exec');
  expect(await livelloDopo(app, 'script.google.com')).toBe('sospetto');
});

test('porta del giro 2, Modulo Google: la password chiesta in un campo di testo fa comparire l\'avviso', async ({ app, openTab }) => {
  await preparaRete(app, {
    'docs.google.com/forms/d/e/1FAIpQL/viewform': '<html><body><h1>Verifica account di posta</h1><form>'
      + domandaGoogle('i1', 'Indirizzo email') + domandaGoogle('i5', 'Password della posta') + '<button>Invia</button></form></body></html>',
  });
  await openTab('https://docs.google.com/forms/d/e/1FAIpQL/viewform');
  expect(await livelloDopo(app, 'docs.google.com')).toBe('sospetto');
});

test('porta del giro 2, Microsoft Forms al suo indirizzo attuale: la password in un campo di testo fa comparire l\'avviso', async ({ app, openTab }) => {
  await preparaRete(app, {
    'forms.cloud.microsoft/r/AbC123': '<html><body><div id="form">'
      + '<span id="QuestionId_r1"><span>Password Microsoft 365</span></span>'
      + '<input data-automation-id="textInput" aria-labelledby="QuestionId_r1" placeholder="Immetti la risposta"></div></body></html>',
  });
  await openTab('https://forms.cloud.microsoft/r/AbC123');
  expect(await livelloDopo(app, 'forms.cloud.microsoft')).toBe('sospetto');
});

test('porta del giro 2, S3: sosia negli indirizzi regionali e pagine per percorso giudicate anche a età nota', async ({ app }) => {
  const v = await app.evaluate(() => {
    const SB = globalThis.SN_SAFEBROWSE;
    const sosia = ['https://paypal-login.s3.us-east-1.amazonaws.com/', 'https://paypal-login.s3-website-us-east-1.amazonaws.com/',
      'https://paypal-login.s3-website.eu-west-1.amazonaws.com/'].map((u) => [u, SB.evaluate(u, {}, {}).level]);
    const percorso = ['https://s3.amazonaws.com/paypal-login/index.html', 'https://storage.googleapis.com/b/login.html']
      .map((u) => { const r = SB.evaluate(u, { hasPassword: true }, { ageDays: 6000 }); return [u, r.level !== 'safe' || !!r.needsLlm]; });
    return { sosia, percorso };
  });
  expect(v.sosia).toEqual(v.sosia.map(([u]) => [u, 'sospetto']));
  expect(v.percorso).toEqual(v.percorso.map(([u]) => [u, true]));
});

test('Modulo Google che chiede i dati della carta in campi di testo: l\'avviso deve comparire', async ({ app, openTab }) => {
  test.fail(true, 'giro 3: i dati di pagamento si riconoscono solo dagli attributi del campo, che un modulo non ha');
  await preparaRete(app, {
    'docs.google.com/forms/d/e/1FAIpQLcarta/viewform': '<html><body><h1>Rimborso Amazon: conferma la carta</h1><form>'
      + domandaGoogle('i1', 'Numero della carta di credito') + domandaGoogle('i5', 'Scadenza') + domandaGoogle('i9', 'CVV')
      + '<button>Invia</button></form></body></html>',
  });
  await openTab('https://docs.google.com/forms/d/e/1FAIpQLcarta/viewform');
  expect(await livelloDopo(app, 'docs.google.com')).toBe('sospetto');
});

test('Microsoft Forms con la domanda della password nella seconda sezione, dopo «Avanti»: l\'avviso deve comparire', async ({ app, openTab }) => {
  test.fail(true, 'giro 3: la pagina si guarda solo nei primi due secondi, una domanda che compare dopo non si vede');
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
  await expect(page.getByText('Password')).toBeVisible();
  expect(await livelloDopo(app, 'forms.cloud.microsoft')).toBe('sospetto');
});

test('Google Sites con il modulo montato qualche secondo dopo il riquadro: l\'avviso deve comparire', async ({ app, openTab }) => {
  test.fail(true, 'giro 3: i riquadri si guardano solo nei primi due secondi e mezzo');
  await preparaRete(app, {
    'sites.google.com/view/posta-lenta': '<html><body><h1>Accesso alla posta</h1>'
      + '<iframe src="https://5678-atari-embeds.googleusercontent.com/embeds/x/user.html" width="500" height="300"></iframe></body></html>',
    '5678-atari-embeds.googleusercontent.com/embeds/x/user.html': '<html><body><p id="c">Caricamento…</p><script>'
      + `setTimeout(() => { document.body.innerHTML = ${JSON.stringify(MODULO)}; }, 4000);</script></body></html>`,
  });
  await openTab('https://sites.google.com/view/posta-lenta');
  expect(await livelloDopo(app, 'sites.google.com', 12000)).toBe('sospetto');
});

test('Apps Script di un dominio aziendale, all\'indirizzo /a/macros/<dominio>/: l\'avviso deve comparire', async ({ app, openTab }) => {
  test.fail(true, 'giro 3: la forma aziendale dell\'indirizzo di Apps Script resta fidata per intero');
  await preparaRete(app, {
    'script.google.com/a/macros/contoso.com/s/AKfy999/exec': '<html><body>'
      + '<iframe src="https://n-def456-0lu-script.googleusercontent.com/userCodeAppPanel" width="600" height="400"></iframe></body></html>',
    'n-def456-0lu-script.googleusercontent.com': `<html><body><h1>Microsoft 365</h1>${MODULO}</body></html>`,
  });
  await openTab('https://script.google.com/a/macros/contoso.com/s/AKfy999/exec');
  expect(await livelloDopo(app, 'script.google.com')).toBe('sospetto');
});
