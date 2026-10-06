// VERIFICA #728 giro 5 — il campo password «a schermo»: siti veri col modulo nascosto in altri modi (r1),
// sosia col modulo in un componente chiuso dichiarato nell'HTML (r2), componenti chiusi esposti alla pagina (r3).

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
    // Niente rete: conta solo il nome, come con un dominio vecchio.
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

const NASCOSTI = {
  'riquadro incorporato in una tendina trasparente':
    '<div style="opacity:0;position:absolute;top:60px;right:0"><iframe src="/login" width="400" height="200"></iframe></div>',
  'tendina ritagliata con clip-path': `<div style="clip-path:inset(0 0 100% 0);position:absolute;top:60px;right:0">${ACCESSO}</div>`,
};

for (const [modo, corpo] of Object.entries(NASCOSTI)) {
  test(`r1 email.com, modulo d'accesso nascosto (${modo}): resta il popup`, async ({ app, openTab }) => {
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

test('r2 paypak.com, password in un componente chiuso dichiarato nell\'HTML: blocco', async ({ app, openTab }) => {
  await servi(app, { 'paypak.com': `<h1>PayPal</h1><div><template shadowrootmode="closed">${ACCESSO}</template></div>` });
  await openTab('https://paypak.com/');
  await expect.poll(() => livello(app, 'paypak.com'), { timeout: 15_000 }).toBe('pericoloso');
});

test('r3 un componente chiuso resta chiuso agli altri script della pagina', async ({ app, openTab }) => {
  await servi(app, {
    'esempio-negozio.com': '<div id="h"></div><script>document.getElementById("h").attachShadow({mode:"closed"}).innerHTML = "<input id=segreto value=123>";</script>',
  });
  const page = await openTab('https://esempio-negozio.com/');
  await page.waitForLoadState('load');
  // Uno script qualunque della pagina (un tracciatore, una pubblicità) non deve arrivare dentro.
  const letto = await page.evaluate(() => {
    for (const k of Object.getOwnPropertySymbols(window)) {
      try { for (const r of window[k] || []) { const el = r.querySelector && r.querySelector('#segreto'); if (el) return el.value; } } catch (_) {}
    }
    try { for (const r of window[Symbol.for('filo.ombreChiuse')] || []) { const el = r.querySelector('#segreto'); if (el) return el.value; } } catch (_) {}
    return null;
  });
  expect(letto).toBeNull();
});
