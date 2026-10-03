// Verifica #813.5 giro 2, rilievo 1: una finestrella aperta dal sito in lista prima del verdetto, che poi il sito
// riscrive (about:blank scritto dall'apritore) o il cui indirizzo cambia senza navigare, resta senza avviso.
import { test, expect } from '../../fixtures/electron.mjs';

async function servi(app, pagine, elencati, ritardo) {
  await app.evaluate(async ({ session, net }, { pg, el, ms }) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({
      gsb: async (url, norm) => {
        await new Promise((r) => setTimeout(r, ms));
        return el.includes(norm.host) ? { listed: true, category: 'phishing' } : null;
      },
      rdap: null, ct: null, sandbox: null,
      llm: async () => ({ suspicious: false, reason: null }),
    });
  }, { pg: pagine, el: elencati, ms: ritardo });
}

async function apri(shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
}

function avvisoSullaScheda(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    return !!tab && tm.avvisoSito.coperta() === tab;
  });
}

async function scrivi(app, testo) {
  await app.evaluate(({ webContents }, t) => {
    const wc = webContents.getFocusedWebContents();
    if (!wc) return;
    for (const ch of t) {
      wc.sendInputEvent({ type: 'keyDown', keyCode: ch });
      wc.sendInputEvent({ type: 'char', keyCode: ch });
      wc.sendInputEvent({ type: 'keyUp', keyCode: ch });
    }
  }, testo);
}

const MODULO = '<title>Accedi</title><form><input name="email" placeholder="Email">'
  + '<input type="password" id="pw" name="pw" placeholder="Password" autofocus><button>Accedi</button></form>'
  + '<script>window.__k="";window.addEventListener("keydown",function(e){window.__k+=e.key},true);'
  + 'setTimeout(function(){document.getElementById("pw").focus()},300)</script>';
const esc = (h) => JSON.stringify(h).replace(/<\//g, '<\\/');

// Le finestrelle col modulo: la pagina sente i tasti? Vuoto se la finestrella non c'è più (è diventata una scheda).
async function tastiNelleFinestrelle(app) {
  const out = [];
  for (const w of app.windows()) {
    try {
      const r = await w.evaluate(() => (document.getElementById('pw') && typeof window.__k === 'string'
        ? { url: location.href, k: window.__k, pw: document.getElementById('pw').value } : null));
      if (r) out.push(r);
    } catch (_) {}
  }
  return out;
}

async function finestrellaSenzaAvviso(app) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => !w._filoTabs && !w.isDestroyed() && w.isVisible() && w.webContents.getType() === 'window')
    .map((w) => w.webContents.getURL()));
}

test('finestrella di accesso aperta prima del verdetto e poi riscritta dal sito in lista in una pagina vuota: niente tasti alla pagina', async ({ app, shell }) => {
  const h = 'conto-vuota.com';
  const idp = 'idp-vuota.org';
  await servi(app, {
    [h + '/login']: '<title>Attendere</title><p>Caricamento…</p><script>var F=' + esc(MODULO)
      + `;var p=window.open("https://${idp}/oauth/authorize?client_id=1&redirect_uri=x","p","width=500,height=600");`
      + 'setTimeout(function(){p.location="about:blank";setTimeout(function(){p.document.open();p.document.write(F);p.document.close()},700)},3000)</script>',
    [idp + '/oauth/authorize']: '<title>Accedi con</title><p>Accesso</p>',
  }, [h], 800);
  await apri(shell, `https://${h}/login`);
  await expect.poll(() => finestrellaSenzaAvviso(app), { timeout: 8000 }).toEqual(expect.arrayContaining([expect.stringContaining(idp)]));
  await expect.poll(() => avvisoSullaScheda(app), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 3500));
  console.log('finestrelle:', JSON.stringify(await finestrellaSenzaAvviso(app)));
  await scrivi(app, 'segreto');
  await new Promise((r) => setTimeout(r, 500));
  const viste = await tastiNelleFinestrelle(app);
  console.log('moduli:', JSON.stringify(viste));
  for (const v of viste) expect(v, v.url).toMatchObject({ k: '', pw: '' });
});

test('finestrella di accesso del sito in lista che cambia indirizzo senza navigare prima del verdetto: niente tasti alla pagina', async ({ app, shell }) => {
  const h = 'conto-sposta.com';
  await servi(app, {
    [h + '/login']: '<title>Attendere</title><p>Caricamento…</p><script>'
      + `window.open("https://${h}/oauth/authorize?client_id=1&redirect_uri=x","p","width=500,height=600")</script>`,
    [h + '/oauth/authorize']: MODULO + '<script>var i=0;setInterval(function(){history.replaceState(null,"",'
      + 'location.pathname+"?client_id=1&redirect_uri=x&t="+(++i))},150)</script>',
  }, [h], 1500);
  await apri(shell, `https://${h}/login`);
  await expect.poll(() => avvisoSullaScheda(app), { timeout: 10000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 2500));
  console.log('finestrelle:', JSON.stringify(await finestrellaSenzaAvviso(app)));
  await scrivi(app, 'segreto');
  await new Promise((r) => setTimeout(r, 500));
  const viste = await tastiNelleFinestrelle(app);
  console.log('moduli:', JSON.stringify(viste));
  for (const v of viste) expect(v, v.url).toMatchObject({ k: '', pw: '' });
});
