// VERIFICA #728 giro 4 — conta il campo password che l'utente vede davvero: un modulo d'accesso nascosto coi modi
// comuni dei siti (menu trasparente, pannello chiuso, cassetto fuori schermo) non fa del sito vero un sosia (r1);
// il modulo di un sosia dentro un componente incapsulato chiuso porta comunque al blocco (r2).

import { test, expect } from '../../fixtures/electron.mjs';

const ACCESSO = '<form><input name="email" placeholder="Email"><input type="password" name="pw"><button>Accedi</button></form>';

async function servi(app, pagine) {
  await app.evaluate(async ({ session, net }, pg) => {
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname] || pg[u.hostname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    });
    // Niente rete: età del dominio e liste nere ignote, come con un dominio vecchio.
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
  }, pagine);
}

const livello = (app, host) => app.evaluate(({ BrowserWindow }, h) => {
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      try { if (new URL(t.view.webContents.getURL()).hostname === h) return t.sbLevel || null; } catch (_) {}
    }
  }
  return null;
}, host);

const NASCOSTI = {
  'menu a tendina trasparente': '<style>.menu{opacity:0;pointer-events:none;position:absolute;top:40px;right:0}</style>'
    + `<h1>Posta gratuita</h1><button>Accedi</button><div class="menu">${ACCESSO}</div>`,
  'pannello chiuso': '<style>.pan{max-height:0;overflow:hidden;transition:max-height .3s}</style>'
    + `<h1>Posta gratuita</h1><button>Accedi</button><div class="pan">${ACCESSO}</div>`,
  'cassetto laterale fuori schermo': '<style>body{overflow-x:hidden}.off{position:fixed;top:0;right:0;width:300px;height:100%;'
    + `transform:translateX(100%)}</style><h1>Posta gratuita</h1><button>Accedi</button><div class="off">${ACCESSO}</div>`,
};

for (const [modo, html] of Object.entries(NASCOSTI)) {
  test(`r1 email.com col modulo d'accesso nascosto (${modo}): popup, non il blocco`, async ({ app, openTab }) => {
    await servi(app, { 'email.com': html });
    await openTab('https://email.com/');
    await expect.poll(() => livello(app, 'email.com'), { timeout: 12_000 }).toBe('sospetto');
    // Più di un giro sui campi della pagina.
    await new Promise((r) => setTimeout(r, 5000));
    expect(await livello(app, 'email.com')).toBe('sospetto');
  });
}

test('r2 paypak.com col modulo d\'accesso in un componente incapsulato chiuso: blocco', async ({ app, openTab }) => {
  await servi(app, {
    'paypak.com': '<h1>PayPal</h1><login-box></login-box><script>customElements.define("login-box", class extends HTMLElement {'
      + `constructor(){super(); this.attachShadow({mode:"closed"}).innerHTML = ${JSON.stringify(ACCESSO)};}});</script>`,
  });
  await openTab('https://paypak.com/');
  await expect.poll(() => livello(app, 'paypak.com'), { timeout: 12_000 }).toBe('pericoloso');
});
