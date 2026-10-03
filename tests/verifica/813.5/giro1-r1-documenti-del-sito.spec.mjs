// Verifica #813.5 giro 1, rilievo 1: documenti che la pagina in lista crea da sé (blob, finestrella di accesso) senza avviso.
import { test, expect } from '../../fixtures/electron.mjs';

async function servi(app, pagine) {
  await app.evaluate(async ({ session, net }, { pg }) => {
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
      gsb: async () => ({ listed: true, category: 'phishing' }), rdap: null, ct: null, sandbox: null,
      llm: async () => ({ suspicious: false, reason: null }),
    });
  }, { pg: pagine });
}

async function apri(app, shell, url) {
  const host = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const fine = Date.now() + 10_000;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } });
    if (p) {
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
        win.focus();
      });
      return p;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nessuna scheda');
}

function stato(app) {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    const col = webContents.getFocusedWebContents();
    const v = tm.avvisoSito.vista;
    return {
      url: tab.view.webContents.getURL(),
      coperta: tm.avvisoSito.coperta() === tab,
      tastiera: v && col === v.webContents ? 'avviso' : (col === tab.view.webContents ? 'pagina' : 'altro'),
    };
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

const blob = (app) => app.windows().find((w) => { try { return w.url().startsWith('blob:'); } catch (_) { return false; } });
const esc = (h) => JSON.stringify(h).replace(/<\//g, '<\\/');

for (const [nome, js] of [
  ['nella stessa scheda', 'location.href=u'],
  ['in una scheda nuova aperta da sola', 'window.open(u)'],
]) {
  test(`la pagina in lista mostra il modulo in un documento blob suo (${nome}): l'avviso resta e i tasti non le arrivano`, async ({ app, shell }) => {
    const h = 'conto-blob-' + (js.startsWith('loc') ? 'a' : 'b') + '.com';
    await servi(app, { [h + '/login']: '<title>Attendere</title><p>Caricamento…</p><script>var F=' + esc(MODULO)
      + ';setTimeout(function(){var u=URL.createObjectURL(new Blob([F],{type:"text/html"}));' + js + '},2500)</script>' });
    await apri(app, shell, 'https://' + h + '/login');
    await expect.poll(async () => (await stato(app)).coperta, { timeout: 8000 }).toBe(true);
    await expect.poll(async () => (await stato(app)).url, { timeout: 8000 }).toMatch(/^blob:/);
    await new Promise((r) => setTimeout(r, 2000));
    expect((await stato(app)).coperta).toBe(true);
    await scrivi(app, 'segreto');
    await new Promise((r) => setTimeout(r, 500));
    const p = blob(app);
    expect(p).toBeTruthy();
    expect(await p.evaluate(() => ({ k: window.__k, pw: document.getElementById('pw').value }))).toEqual({ k: '', pw: '' });
  });
}

test('la pagina in lista apre da sola una finestrella di «accesso» col suo modulo: anche lì c\'è l\'avviso e i tasti non le arrivano', async ({ app, shell }) => {
  const h = 'conto-finestrella.com';
  await servi(app, {
    [h + '/login']: '<title>Attendere</title><p>Caricamento…</p><script>setTimeout(function(){'
      + 'window.open("https://' + h + '/oauth/authorize?client_id=1&redirect_uri=x","p","width=500,height=600")},2500)</script>',
    [h + '/oauth/authorize']: MODULO,
  });
  await apri(app, shell, 'https://' + h + '/login');
  await expect.poll(async () => (await stato(app)).coperta, { timeout: 8000 }).toBe(true);
  const finestrella = async () => app.windows().find((w) => { try { return w.url().includes('/oauth/authorize'); } catch (_) { return false; } });
  await expect.poll(async () => !!(await finestrella()), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 1500));
  await scrivi(app, 'segreto');
  await new Promise((r) => setTimeout(r, 500));
  const p = await finestrella();
  expect(await p.evaluate(() => ({ k: window.__k, pw: document.getElementById('pw').value }))).toEqual({ k: '', pw: '' });
});
