// Verifica #729 giro 1: Customer Voice e Hugging Face Spaces giudicati quando chiedono la password, coi casi che il
// lavoro non prova (riquadro che arriva tardi, host scritto in maiuscolo, impostazioni dello Space, due Space nella scheda).

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
    globalThis.SN_SAFEBROWSE.setProviders({
      sandbox: null,
      llm: async (meta) => (meta.hostedOn && (meta.hasPassword || meta.hasPayment)
        ? { suspicious: true, reasonKey: 'hosted_credentials', reason: null, confidence: 'high' } : { suspicious: false, reason: null }),
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

const ACCESSO = '<form><input name="email" placeholder="Email"><input type="password" name="pw"><button>Accedi</button></form>';

test('Space che monta il riquadro dell\'app dopo qualche secondo: l\'avviso arriva lo stesso', async ({ app, openTab }) => {
  await servi(app, {
    'huggingface.co/spaces/qualcuno/posta-lenta': '<h1>Posta</h1><div id="c">Building…</div><script>setTimeout(() => {'
      + ' document.getElementById("c").innerHTML = \'<iframe src="https://qualcuno-posta-lenta.hf.space/" width="600" height="300"></iframe>\'; }, 3000);</script>',
    'qualcuno-posta-lenta.hf.space': ACCESSO,
  });
  const url = 'https://huggingface.co/spaces/qualcuno/posta-lenta';
  const page = await openTab(url);
  expect(await livello(app, url, 15000)).toBe('sospetto');
  await page.waitForTimeout(800);
  const vista = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/avviso-sito.html'); } catch (_) { return false; } });
  if (vista) await vista.screenshot({ path: 'tests/.shots/verifica-729-hf-avviso.png' }).catch(() => {});
});

test('questionario Customer Voice con l\'indirizzo in maiuscolo e la lingua: l\'avviso arriva', async ({ app, openTab }) => {
  await servi(app, {
    'customervoice.microsoft.com/Pages/ResponsePage.aspx': '<h1>Verifica casella</h1><form><label>Password <input></label></form>',
  });
  await openTab('https://CUSTOMERVOICE.MICROSOFT.COM/Pages/ResponsePage.aspx?ID=Qz1&lang=it-IT');
  expect(await livello(app, 'https://customervoice.microsoft.com/Pages/ResponsePage.aspx?ID=Qz1&lang=it-IT')).toBe('sospetto');
});

test('le impostazioni dello Space, che vede solo chi l\'ha pubblicato, restano di Hugging Face', async ({ app, openTab }) => {
  await servi(app, {
    'huggingface.co/spaces/qualcuno/app/settings': '<h1>Settings</h1><form><label>Secret value <input type="password"></label></form>',
  });
  const url = 'https://huggingface.co/spaces/qualcuno/app/settings';
  await openTab(url);
  expect(await livello(app, url, 4000)).toBe('safe');
});

test('due Space nella stessa scheda: l\'avviso chiuso sul primo non silenzia il secondo', async ({ app, openTab }) => {
  await servi(app, {
    'huggingface.co/spaces/uno/posta': '<iframe src="https://uno-posta.hf.space/" width="600" height="300"></iframe>',
    'uno-posta.hf.space': ACCESSO,
    'huggingface.co/spaces/due/posta': '<iframe src="https://due-posta.hf.space/" width="600" height="300"></iframe>',
    'due-posta.hf.space': ACCESSO,
  });
  const a = 'https://huggingface.co/spaces/uno/posta';
  const b = 'https://huggingface.co/spaces/due/posta';
  const page = await openTab(a);
  expect(await livello(app, a)).toBe('sospetto');
  await app.evaluate(({ BrowserWindow }, u) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      const t = tm && tm.tabs.find((x) => x.view.webContents.getURL() === u);
      if (t) tm.safebrowseDismiss(t.id, u);
    }
  }, a);
  await page.goto(b).catch(() => {});
  expect(await livello(app, b)).toBe('sospetto');
});
