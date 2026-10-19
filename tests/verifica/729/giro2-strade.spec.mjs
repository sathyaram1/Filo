// Verifica #729 giro 2: le altre strade per arrivare a un questionario Customer Voice o a uno Space che chiede dati
// delicati (campo che compare tardi, navigazione senza ricarica, Space statico con la carta, ricarica dopo «Continua»).

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
    globalThis.__giudizi = 0;
    globalThis.SN_SAFEBROWSE.setProviders({
      sandbox: null,
      llm: async (meta) => {
        globalThis.__giudizi += 1;
        return (meta.hostedOn && (meta.hasPassword || meta.hasPayment)
          ? { suspicious: true, reasonKey: 'hosted_credentials', reason: null, confidence: 'high' } : { suspicious: false, reason: null });
      },
    });
  }, pagine);
}

async function livello(app, url, ms = 9000) {
  const fine = Date.now() + ms;
  let l = null;
  while (Date.now() < fine) {
    l = await app.evaluate(({ BrowserWindow }, u) => {
      for (const w of BrowserWindow.getAllWindows()) {
        for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
          try { if (t.view.webContents.getURL() === u) return t.sbLevel || null; } catch (_) {}
        }
      }
      return null;
    }, url);
    if (l === 'sospetto' || l === 'pericoloso') return l;
    await new Promise((r) => setTimeout(r, 300));
  }
  return l;
}

test('questionario Customer Voice che disegna le domande quattro secondi dopo il caricamento', async ({ app, openTab }) => {
  await servi(app, {
    'customervoice.microsoft.com/Pages/ResponsePage.aspx': '<div id="q">Caricamento…</div><script>setTimeout(() => {'
      + ' document.getElementById("q").innerHTML = \'<div id="t">Conferma la password della tua casella</div><input aria-labelledby="t">\'; }, 4000);</script>',
  });
  const url = 'https://customervoice.microsoft.com/Pages/ResponsePage.aspx?id=Lento1';
  await openTab(url);
  expect(await livello(app, url, 15000)).toBe('sospetto');
});

test('dall\'elenco degli Space all\'app senza ricaricare la pagina: l\'avviso arriva', async ({ app, openTab }) => {
  await servi(app, {
    'huggingface.co/spaces': '<a id="v" href="#">Posta</a><div id="c"></div><script>document.getElementById("v").onclick = (e) => {'
      + ' e.preventDefault(); history.pushState({}, "", "/spaces/qualcuno/posta-spa");'
      + ' document.getElementById("c").innerHTML = \'<iframe src="https://qualcuno-posta-spa.hf.space/" width="600" height="300"></iframe>\'; };</script>',
    'qualcuno-posta-spa.hf.space': '<form><input name="email"><input type="password"><button>Accedi</button></form>',
  });
  const page = await openTab('https://huggingface.co/spaces');
  await page.click('#v');
  expect(await livello(app, 'https://huggingface.co/spaces/qualcuno/posta-spa', 12000)).toBe('sospetto');
});

test('Space statico che chiede la carta: l\'avviso arriva', async ({ app, openTab }) => {
  await servi(app, {
    'huggingface.co/spaces/qualcuno/negozio': '<iframe src="https://qualcuno-negozio.static.hf.space/index.html" width="600" height="300"></iframe>',
    'qualcuno-negozio.static.hf.space': '<form><label>Numero della carta <input></label><label>CVV <input></label></form>',
  });
  const url = 'https://huggingface.co/spaces/qualcuno/negozio';
  await openTab(url);
  expect(await livello(app, url)).toBe('sospetto');
});

test('dopo «Continua» sullo Space, ricaricarlo non ripropone l\'avviso', async ({ app, openTab }) => {
  await servi(app, {
    'huggingface.co/spaces/qualcuno/chiave': '<iframe src="https://qualcuno-chiave.hf.space/" width="600" height="300"></iframe>',
    'qualcuno-chiave.hf.space': '<form><input type="password" placeholder="Password"></form>',
  });
  const url = 'https://huggingface.co/spaces/qualcuno/chiave';
  const page = await openTab(url);
  expect(await livello(app, url)).toBe('sospetto');
  await app.evaluate(({ BrowserWindow }, u) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      const t = tm && tm.tabs.find((x) => x.view.webContents.getURL() === u);
      if (t) tm._sbScelta(t, 'continua');
    }
  }, url);
  await page.reload().catch(() => {});
  expect(await livello(app, url, 5000)).toBe('safe');
});
