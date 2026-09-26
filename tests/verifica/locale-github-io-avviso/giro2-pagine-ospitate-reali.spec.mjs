// Giro 2 della verifica «avviso GitHub su github.io»: le pagine ospitate come sono fatte davvero (campo password in un
// riquadro, moduli senza campo password) e gli indirizzi di S3 nella forma regionale, da sito statico e per percorso.
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

// Le pagine si servono intercettando https nella sessione delle schede; il giudice AI è sostituito da uno che fa
// quello che il suo prompt chiede: sospetta una pagina ospitata che chiede password o pagamento.
async function preparaRete(app, pagine) {
  await app.evaluate(async ({ session, net }, pg) => {
    globalThis.__giudizi = [];
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
        globalThis.__giudizi.push(meta);
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

test('controllo: su Google Sites un campo password nella pagina fa partire il giudizio e l\'avviso', async ({ app, openTab }) => {
  await preparaRete(app, { 'sites.google.com/view/controllo-diretto': `<html><body><h1>Accedi a PayPal</h1>${MODULO}</body></html>` });
  await openTab('https://sites.google.com/view/controllo-diretto');
  expect(await livelloDopo(app, 'sites.google.com')).toBe('sospetto');
});

test('Google Sites: il modulo con la password sta in un riquadro incorporato, e l\'avviso deve comparire lo stesso', async ({ app, openTab }) => {
  test.fail(true, 'giro 2: il campo password in un riquadro non viene visto, il giudizio non parte');
  await preparaRete(app, {
    'sites.google.com/view/paypal-login': '<html><body><h1>PayPal - Accedi</h1>'
      + '<iframe src="https://1234-atari-embeds.googleusercontent.com/embeds/abc/inner-frame-minified.html" width="500" height="300"></iframe></body></html>',
    '1234-atari-embeds.googleusercontent.com': `<html><body>${MODULO}</body></html>`,
  });
  await openTab('https://sites.google.com/view/paypal-login');
  expect(await livelloDopo(app, 'sites.google.com')).toBe('sospetto');
});

test('Apps Script: la pagina dell\'utente sta sempre in un riquadro, e l\'avviso deve comparire', async ({ app, openTab }) => {
  test.fail(true, 'giro 2: il campo password in un riquadro non viene visto, il giudizio non parte');
  await preparaRete(app, {
    'script.google.com/macros/s/AKfy123/exec': '<html><body>'
      + '<iframe src="https://n-abc123-0lu-script.googleusercontent.com/userCodeAppPanel" width="600" height="400"></iframe></body></html>',
    'n-abc123-0lu-script.googleusercontent.com': `<html><body><h1>Microsoft 365</h1>${MODULO}</body></html>`,
  });
  await openTab('https://script.google.com/macros/s/AKfy123/exec');
  expect(await livelloDopo(app, 'script.google.com')).toBe('sospetto');
});

test('Modulo Google: chiede la password in un campo di testo, perché un campo password lì non esiste, e l\'avviso deve comparire', async ({ app, openTab }) => {
  test.fail(true, 'giro 2: un modulo non ha campi password, quindi la regola non scatta mai');
  await preparaRete(app, {
    'docs.google.com/forms/d/e/1FAIpQL/viewform': '<html><body><h1>Verifica account di posta</h1><form>'
      + '<label>Indirizzo email<input type="text" aria-label="Indirizzo email"></label>'
      + '<label>Password della posta<input type="text" aria-label="Password della posta"></label>'
      + '<button>Invia</button></form></body></html>',
  });
  await openTab('https://docs.google.com/forms/d/e/1FAIpQL/viewform');
  expect(await livelloDopo(app, 'docs.google.com')).toBe('sospetto');
});

test('S3: un sosia è segnalato anche negli indirizzi regionali e da sito statico, e le pagine per percorso vanno giudicate', async ({ app }) => {
  test.fail(true, 'giro 2: solo l\'indirizzo globale di S3 separa il secchio dell\'utente');
  const v = await app.evaluate(() => {
    const SB = globalThis.SN_SAFEBROWSE;
    const sosia = ['https://paypal-login.s3.us-east-1.amazonaws.com/', 'https://paypal-login.s3.eu-west-1.amazonaws.com/index.html',
      'https://paypal-login.s3-website-us-east-1.amazonaws.com/', 'https://paypal-login.s3-website.eu-west-1.amazonaws.com/']
      .map((u) => [u, SB.evaluate(u, {}, {}).level]);
    const percorso = ['https://s3.amazonaws.com/paypal-login/index.html', 'https://s3.eu-west-1.amazonaws.com/b/login.html',
      'https://storage.googleapis.com/b/login.html']
      .map((u) => { const r = SB.evaluate(u, { hasPassword: true }, { ageDays: 6000 }); return [u, r.level !== 'safe' || !!r.needsLlm]; });
    return { sosia, percorso };
  });
  expect(v.sosia).toEqual(v.sosia.map(([u]) => [u, 'sospetto']));
  expect(v.percorso).toEqual(v.percorso.map(([u]) => [u, true]));
});
