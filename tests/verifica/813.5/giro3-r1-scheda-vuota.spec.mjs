// #813.5 giro 3: la finestrella del sito in lista, aperta prima del verdetto, porta la SCHEDA che l'ha aperta su una
// pagina vuota e ci scrive il modulo d'accesso. La scheda deve restare sotto l'avviso, e i tasti non devono arrivarle.
import { test, expect } from '../../fixtures/electron.mjs';

const FORM = '<title>Accedi</title><form><input name="email" placeholder="Email">'
  + '<input type="password" id="pw" name="pw" placeholder="Password"><button>Accedi</button></form>';
const KEYLOG = 'window.__k="";addEventListener("keydown",function(e){window.__k+=e.key},true);'
  + 'setTimeout(function(){document.getElementById("pw").focus()},300)';

async function prepara(app, pagine, host, ms) {
  await app.evaluate(async ({ session, net }, { pg, host, ms }) => {
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
      gsb: async (url, norm) => { await new Promise((r) => setTimeout(r, ms)); return norm.host === host ? { listed: true, category: 'phishing' } : null; },
      rdap: null, ct: null, sandbox: null, llm: async () => ({ suspicious: false, reason: null }),
    });
  }, { pg: pagine, host, ms });
}

const stato = (app) => app.evaluate(({ BrowserWindow, webContents }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  const tm = win._filoTabs;
  const tab = tm.tabs.find((t) => t.id === tm.activeId);
  const v = tm.avvisoSito.vista;
  const col = webContents.getFocusedWebContents();
  return {
    url: tab.view.webContents.getURL(),
    coperta: tm.avvisoSito.coperta() === tab,
    tastiera: v && col === v.webContents ? 'avviso' : (col === tab.view.webContents ? 'pagina' : 'altro'),
  };
});

// La scheda di partenza (la prima aperta sul sito), attivata come fa l'utente che ci torna.
const modulo = (app, attiva = false) => app.evaluate(async ({ BrowserWindow }, attiva) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const tab = tm.tabs.find((t) => t._sbProva);
  if (attiva && tm.activeId !== tab.id) tm.activate(tab.id);
  const r = await tab.view.webContents.executeJavaScript('({ pw: !!document.getElementById("pw"), k: window.__k, v: (document.getElementById("pw")||{}).value })');
  return { ...r, url: tab.view.webContents.getURL(), schede: tm.tabs.map((t) => t.view.webContents.getURL()) };
}, attiva);

for (const [nome, scrivi] of [
  ['riscritta pezzo per pezzo', 'var d=opener.document;d.body.innerHTML=F;var s=d.createElement("script");s.textContent=K;d.body.appendChild(s);'],
  ['riscritta con document.write', 'opener.document.open();opener.document.write(F+"<script>"+K+"<\\/script>");opener.document.close();'],
]) {
  test(`la finestrella porta la scheda su una pagina vuota col modulo (${nome}): la scheda resta sotto l'avviso`, async ({ app, shell }) => {
    const h = `conto-scheda-vuota-${nome.length}.com`;
    await prepara(app, {
      [h + '/login']: `<title>Attendere</title><p>Caricamento…</p><script>if(!localStorage.aperta){localStorage.aperta=1;window.open("https://${h}/oauth/authorize?client_id=1&redirect_uri=x","p","width=500,height=600")}</script>`,
      [h + '/oauth/authorize']: '<title>Accedi con</title><script>var F=' + JSON.stringify(FORM) + ';var K=' + JSON.stringify(KEYLOG)
        + ';console.log("opener",!!opener);opener.location="about:blank";setTimeout(function(){try{' + scrivi + 'console.log("scritto")}catch(e){console.log("errore "+e)}},400)</script>',
    }, h, 1500);
    await app.evaluate(({ app: a }) => { globalThis.__log = []; a.on('web-contents-created', (_e, wc) => wc.on('console-message', (ev, l, m) => globalThis.__log.push(wc.getURL().slice(0, 60) + ' :: ' + (typeof ev === 'object' && ev.message ? ev.message : m)))); });
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `https://${h}/login`);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      const tab = tm.tabs.find((t) => /\/login$/.test(t._urlNavigato || ''));
      if (tab) tab._sbProva = true;
      return !!tab;
    })).toBe(true);
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 500));
      console.log(i, JSON.stringify(await modulo(app).catch((e) => String(e))));
    }
    console.log(JSON.stringify(await app.evaluate(() => globalThis.__log)));
    await expect.poll(async () => (await modulo(app).catch(() => ({}))).pw, { timeout: 10_000 }).toBe(true);
    await new Promise((r) => setTimeout(r, 3000));
    console.log('torna', JSON.stringify(await modulo(app, true)));
    await new Promise((r) => setTimeout(r, 500));
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((w) => w._filoTabs).focus(); });
    const s = await stato(app);
    console.log('stato', JSON.stringify(s));
    expect(s.coperta).toBe(true);
    expect(s.tastiera).toBe('avviso');
  });
}
