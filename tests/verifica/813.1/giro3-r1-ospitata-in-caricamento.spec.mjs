import { test, expect } from '../../fixtures/electron.mjs';

async function servi(app, pagine, { gsbDelay = -1, llmHosted = false } = {}) {
  await app.evaluate(async ({ session, net }, { pg, gsbDelay, llmHosted }) => {
    globalThis.__sbLenti = [];
    const risposta = (req) => {
      const u = new URL(req.url);
      if (u.pathname === '/lento.js') {
        const body = new ReadableStream({ start: (c) => { globalThis.__sbLenti.push(c); } });
        return new Response(body, { headers: { 'content-type': 'text/javascript' } });
      }
      const html = pg[u.hostname + u.pathname] || pg[u.hostname];
      if (html && u.searchParams.has('aperto')) {
        const body = new ReadableStream({ start: (c) => { globalThis.__sbLenti.push(c); c.enqueue(new TextEncoder().encode(html)); } });
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
      gsb: gsbDelay >= 0 ? async (url) => {
        await new Promise((r) => setTimeout(r, gsbDelay));
        return /phish|conto-/.test(url) ? { listed: true, category: 'phishing' } : null;
      } : null,
      rdap: null, ct: null, sandbox: null,
      llm: async (meta) => (llmHosted && meta.hostedOn && (meta.hasPassword || meta.hasPayment)
        ? { suspicious: true, reasonKey: 'hosted_credentials', reason: null, confidence: 'high' } : { suspicious: false, reason: null }),
    });
  }, { pg: pagine, gsbDelay, llmHosted });
}
async function chiudiLenti(app) {
  await app.evaluate(() => { for (const c of globalThis.__sbLenti || []) { try { c.close(); } catch (_) {} } }).catch(() => {});
}
async function apri(app, shell, url) {
  const host = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const fine = Date.now() + 10_000;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`nessuna scheda per ${url}`);
}

// Un modulo d'accesso pubblicato su Google Sites, nel riquadro incorporato, seguito da uno script che il server tiene
// aperto: il riquadro non finisce mai di caricarsi e l'avviso «Pagina pubblicata da un utente» deve comparire lo stesso.
test('pagina ospitata: il riquadro col modulo che resta in caricamento fa comparire l\'avviso', async ({ app, shell }) => {
  await servi(app, {
    'sites.google.com/view/posta-appesa': '<h1>Accesso alla posta</h1>'
      + '<iframe src="https://9999-atari-embeds.googleusercontent.com/embeds/x/user.html" width="500" height="300"></iframe>',
    '9999-atari-embeds.googleusercontent.com': '<form><input name="email"><input type="password" id="pw"></form><script src="/lento.js"></script>',
  }, { llmHosted: true });
  try {
    const page = await apri(app, shell, 'https://sites.google.com/view/posta-appesa');
    await expect(page.getByText('Pagina pubblicata da un utente')).toBeVisible({ timeout: 12000 });
  } finally { await chiudiLenti(app); }
});
