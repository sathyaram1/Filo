// VERIFICA #728 giro 5 — porte nuove sul «campo password a schermo».

import { test, expect } from '../../fixtures/electron.mjs';

async function servi(app, pagine) {
  await app.evaluate(async ({ session, net }, pg) => {
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname] || pg[u.hostname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    });
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
  }, pagine);
}

async function livello(app, host) {
  return app.evaluate(({ BrowserWindow }, h) => {
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
        try { if (new URL(t.view.webContents.getURL()).hostname === h) return t.sbLevel || null; } catch (_) {}
      }
    }
    return null;
  }, host);
}

const ACCESSO = '<form><input name="email" placeholder="Email"><input type="password" name="pw"><button>Accedi</button></form>';

// Sito vero dal nome comune: il modulo nascosto non deve portare al blocco.
const NASCOSTI = {
  'riquadro incorporato nascosto': ['<iframe id="m" src="/login" style="display:none" width="400" height="200"></iframe>'],
  'riquadro incorporato in una tendina trasparente': ['<div style="opacity:0;position:absolute;top:60px;right:0"><iframe src="/login" width="400" height="200"></iframe></div>'],
  'tendina ritagliata con clip-path': ['<div style="clip-path:inset(0 0 100% 0);position:absolute;top:60px;right:0">' + ACCESSO + '</div>'],
};

for (const [modo, [corpo]] of Object.entries(NASCOSTI)) {
  test(`email.com, modulo nascosto (${modo}): resta il popup`, async ({ app, openTab }) => {
    await servi(app, {
      'email.com/login': `<!doctype html><body>${ACCESSO}</body>`,
      'email.com': `<h1>Posta gratuita</h1><button>Accedi</button>${corpo}`,
    });
    await openTab('https://email.com/');
    await expect.poll(() => livello(app, 'email.com'), { timeout: 12_000 }).toBe('sospetto');
    await new Promise((r) => setTimeout(r, 5000));
    expect(await livello(app, 'email.com')).toBe('sospetto');
  });
}

// Sosia: la password a schermo deve portare al blocco.
const SOSIA = {
  'componente chiuso dichiarato nell\'HTML': `<div><template shadowrootmode="closed">${ACCESSO}</template></div>`,
  'componente chiuso creato da uno script in testa': `<script>document.addEventListener('DOMContentLoaded',()=>{});</script>`
    + `<div id="h"></div><script>document.getElementById('h').attachShadow({mode:'closed'}).innerHTML=${JSON.stringify(ACCESSO)};</script>`,
  'componente chiuso dentro un riquadro': '<iframe src="/inner" width="400" height="200"></iframe>',
};

for (const [modo, corpo] of Object.entries(SOSIA)) {
  test(`paypak.com, password in ${modo}: blocco`, async ({ app, openTab }) => {
    await servi(app, {
      'paypak.com/inner': `<!doctype html><body><div id="h"></div><script>document.getElementById('h').attachShadow({mode:'closed'}).innerHTML=${JSON.stringify(ACCESSO)};</script></body>`,
      'paypak.com': `<h1>PayPal</h1>${corpo}`,
    });
    const page = await openTab('https://paypak.com/');
    await expect.poll(() => livello(app, 'paypak.com'), { timeout: 15_000 }).toBe('pericoloso');
    void page;
  });
}
