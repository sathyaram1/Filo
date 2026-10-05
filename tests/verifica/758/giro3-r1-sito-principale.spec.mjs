// #758 giro 3 — il sito B, visto prima incorporato in A, aperto poi come sito principale nella stessa scheda (link
// o indirizzo scritto): i cookie che la sua pagina mette arrivando sono del sito principale e non si declassano.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function serve() {
  const server = createServer((req, res) => {
    const porta = server.address().port;
    if (req.url.startsWith('/riquadro')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': ['mid=1; Max-Age=3600; Path=/; SameSite=None; Secure'] });
      res.end('<p>riquadro</p>');
      return;
    }
    if (req.url.startsWith('/home-pref')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': ['pref=scuro; Max-Age=86400; Path=/'] });
      res.end('<title>HOME B</title><p id="b">home di B</p>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>ARTICOLO</title><a id="vai" href="http://b.localhost:${porta}/home-pref">vai a B</a>`
      + `<a id="nuova" target="_blank" href="http://b.localhost:${porta}/home-pref?n=1">B in una scheda nuova</a>`
      + `<iframe id="ri" width="200" height="120" src="http://b.localhost:${porta}/riquadro"></iframe>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    articolo: `http://a.localhost:${porta}/`,
    homeB: `http://b.localhost:${porta}/home-pref`,
    async chiudi() { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

const pref = (app) => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ domain: 'b.localhost', name: 'pref' }))
  .map((c) => (c.session ? 'sessione' : 'scadenza')));
const midSessione = (app) => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ domain: 'b.localhost', name: 'mid' }))
  .map((c) => c.session));

async function pulisci(app) {
  await app.evaluate(async () => {
    const S = globalThis.__filoCookieIncorporati;
    S.margineTest(800);
    for (let i = 0; i < 25; i++) { await S.giroDiPulizia(); await new Promise((r) => setTimeout(r, 150)); }
  });
}
function chiudiSchede(app, pezzo) {
  return app.evaluate(({ BrowserWindow }, frammento) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs; if (!tm) continue;
      for (const t of [...(tm.tabs || [])]) if (String(t.url || '').includes(frammento)) { try { tm.closeTab(t.id); } catch (_) {} }
    }
  }, pezzo);
}

test('dal link nell\'articolo si va su B nella stessa scheda: il cookie della home di B resta con la sua scadenza', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    const page = await openTab(srv.articolo);
    await expect.poll(() => midSessione(app), { timeout: 10_000 }).toEqual([true]);
    await page.click('#vai');
    await expect.poll(() => pref(app), { timeout: 10_000 }).not.toEqual([]);
    await new Promise((r) => setTimeout(r, 1000));
    const durante = await pref(app);
    await chiudiSchede(app, 'b.localhost');
    await pulisci(app);
    expect({ durante, dopo: await pref(app) }).toEqual({ durante: ['scadenza'], dopo: ['scadenza'] });
  } finally { await srv.chiudi(); }
});

test('letto l\'articolo e chiuso, B scritto nella barra di una scheda già aperta su una pagina di Filo: il cookie della home di B resta', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await openTab(srv.articolo);
    await expect.poll(() => midSessione(app), { timeout: 10_000 }).toEqual([true]);
    await chiudiSchede(app, 'a.localhost');
    await openTab('filo://security/');
    await app.evaluate(({ BrowserWindow }, u) => {
      for (const w of BrowserWindow.getAllWindows()) {
        const tm = w._filoTabs; if (!tm) continue;
        const t = tm.tabs.find((x) => String(x.url || '').startsWith('filo://security'));
        if (t) tm.navigate(t.id, u);
      }
    }, srv.homeB);
    await expect.poll(() => pref(app), { timeout: 10_000 }).not.toEqual([]);
    await new Promise((r) => setTimeout(r, 1000));
    const durante = await pref(app);
    await chiudiSchede(app, 'b.localhost');
    await pulisci(app);
    expect({ durante, dopo: await pref(app) }).toEqual({ durante: ['scadenza'], dopo: ['scadenza'] });
  } finally { await srv.chiudi(); }
});

test('dal link dell\'articolo che apre B in una scheda nuova: il cookie della home di B resta', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    const page = await openTab(srv.articolo);
    await expect.poll(() => midSessione(app), { timeout: 10_000 }).toEqual([true]);
    await page.click('#nuova');
    await expect.poll(() => pref(app), { timeout: 10_000 }).not.toEqual([]);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await pref(app)).toEqual(['scadenza']);
  } finally { await srv.chiudi(); }
});

test('controprova: B aperto in una scheda nuova, mai visto incorporato, tiene il cookie', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await openTab(srv.homeB);
    await expect.poll(() => pref(app), { timeout: 10_000 }).not.toEqual([]);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await pref(app)).toEqual(['scadenza']);
  } finally { await srv.chiudi(); }
});
