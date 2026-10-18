// #894 giro 2: nell'app vera, l'età si chiede solo con un indizio, arriva prima di giudizio AI e finestra isolata, e un
// negozio nuovo che chiede la carta riceve l'avviso. Pagine servite intercettando https, fornitori finti che contano.
import { test, expect } from '../../fixtures/electron.mjs';

async function prepara(app, pagine, eta) {
  await app.evaluate(async ({ session, net }, { pg, eta }) => {
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname] || pg[u.hostname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    });
    const SB = globalThis.SN_SAFEBROWSE;
    for (const c of Object.values(SB._caches)) c.m.clear();
    const conta = globalThis.__conta894 = { rdap: [], ct: [], llm: [], sandbox: [] };
    const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
    SB.setProviders({
      gsb: null,
      rdap: async (r) => { conta.rdap.push(r); await attesa(300); return eta[r] ?? null; },
      ct: async (r) => { conta.ct.push(r); return null; },
      llm: async (m) => { conta.llm.push(m); return { suspicious: false, reason: null }; },
      sandbox: async (u) => { conta.sandbox.push(u); return { verdict: 'clean' }; },
    });
  }, { pg: pagine, eta });
}

const conta = (app) => app.evaluate(() => globalThis.__conta894);

async function livello(app, host, ms = 6000) {
  const fine = Date.now() + ms;
  let l = null;
  while (Date.now() < fine) {
    l = await app.evaluate(({ BrowserWindow }, h) => {
      for (const w of BrowserWindow.getAllWindows()) {
        for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
          try { if (new URL(t.view.webContents.getURL()).hostname === h) return t.sbLevel || null; } catch (_) {}
        }
      }
      return null;
    }, host);
    if (l === 'sospetto' || l === 'pericoloso') return l;
    await new Promise((r) => setTimeout(r, 250));
  }
  return l;
}

const ACCESSO = '<h1>Accedi</h1><form><input name="email"><input type="password" name="pw"><button>Entra</button></form>';
const CASSA = '<h1>Cassa</h1><form><input autocomplete="cc-number" name="carta" placeholder="Numero carta"><button>Paga</button></form>';

test('pagina pulita: nessuna domanda ai registri; login su un sito vecchio: una domanda, zero giudizi e zero finestre', async ({ app, openTab }) => {
  await prepara(app, {
    'forno-esempio-894.com': '<h1>Il forno</h1><p>pane</p>',
    'vecchio-esempio-894.com/accedi': ACCESSO,
  }, { 'vecchio-esempio-894.com': 4000 });
  await openTab('https://forno-esempio-894.com/');
  await new Promise((r) => setTimeout(r, 2500));
  expect((await conta(app)).rdap).toEqual([]);
  await openTab('https://vecchio-esempio-894.com/accedi');
  await new Promise((r) => setTimeout(r, 3500));
  const c = await conta(app);
  expect(c.rdap).toEqual(['vecchio-esempio-894.com']);
  expect(c.ct).toEqual([]);
  expect(c.llm.length).toBe(0);
  expect(c.sandbox.length).toBe(0);
});

test('un negozio registrato due giorni fa: sulla cassa compare l\'avviso «registrato da poco», e il giudizio riceve l\'età', async ({ app, openTab }) => {
  await prepara(app, { 'negozio-nuovo-894.com/cassa': CASSA }, { 'negozio-nuovo-894.com': 2 });
  await openTab('https://negozio-nuovo-894.com/cassa');
  expect(await livello(app, 'negozio-nuovo-894.com')).toBe('sospetto');
  await new Promise((r) => setTimeout(r, 2500));
  const c = await conta(app);
  expect(c.rdap).toEqual(['negozio-nuovo-894.com']);
  expect(c.llm.length).toBeLessThanOrEqual(1);
  for (const m of c.llm) expect(m.ageDays).toBe(2);
  expect(c.sandbox.length).toBeLessThanOrEqual(1);
});
