// #1083 — l'icona di una scheda la scarica il main con la sessione della scheda e la barra riceve un data: URL.
// Prima la barra (sessione predefinita) chiedeva lei l'indirizzo dichiarato dalla pagina: in incognito la
// richiesta partiva coi cookie e la cache del profilo normale.

import { test, expect } from './fixtures/electron.mjs';

// PNG 1×1 vero: la barra lo deve ricevere coi suoi byte.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

async function barraIncognito(app) {
  let p = null;
  await expect.poll(() => {
    p = app.windows().find((w) => { try { return w.url().includes('incognito=1'); } catch (_) { return false; } });
    return !!p;
  }, { timeout: 15000 }).toBe(true);
  return p;
}

const sfondoIcona = (barra) => barra.evaluate(() =>
  [...document.querySelectorAll('.tab')].map((t) => t.querySelector('.favicon')?.style.backgroundImage || ''));

test('in incognito l\'icona della pagina arriva dalla sessione della scheda, mai da quella del profilo normale', async ({ app, shell }) => {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return w ? w._filoTabs.tabs.length : 0;
  }), { timeout: 15000 }).toBe(1);

  // Un sito https servito dentro ciascuna sessione: chi chiede cosa, e da dove, resta registrato.
  await app.evaluate(({ BrowserWindow, session, net }, png) => {
    const incognito = session.fromPartition(BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.partition);
    const richieste = { incognito: [], normale: [] };
    globalThis.__richiesteIcona = richieste;
    const sito = (dove) => (req) => {
      const u = new URL(req.url);
      if (u.hostname !== 'icona.test') return net.fetch(req, { bypassCustomProtocolHandlers: true });
      richieste[dove].push(u.pathname);
      if (u.pathname === '/icona.png') return new Response(Buffer.from(png, 'base64'), { headers: { 'content-type': 'image/png' } });
      return new Response('<!doctype html><html><head><meta charset="utf-8"><title>Riservata</title>'
        + '<link rel="icon" href="https://icona.test/icona.png"></head><body><h1>Riservata</h1></body></html>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
    incognito.protocol.handle('https', sito('incognito'));
    session.defaultSession.protocol.handle('https', sito('normale'));
    BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.openTab('https://icona.test/pagina');
  }, PNG_B64);

  const barra = await barraIncognito(app);
  await expect.poll(async () => (await sfondoIcona(barra)).some((s) => s.includes(`data:image/png;base64,${PNG_B64}`)), {
    timeout: 15000, message: 'la scheda in incognito doveva mostrare l\'icona del sito',
  }).toBe(true);

  const richieste = await app.evaluate(() => globalThis.__richiesteIcona);
  expect(richieste.incognito, 'l\'icona la scarica la sessione della scheda').toContain('/icona.png');
  expect(richieste.normale, 'niente del sito visitato in incognito passa dal profilo normale').toEqual([]);
  // Nessun indirizzo dichiarato da una pagina finisce nella barra.
  expect((await sfondoIcona(barra)).filter((s) => s && !s.includes('data:image/'))).toEqual([]);
});

test('anche nella finestra normale la barra mostra l\'icona come data: URL, pure da un sito http', async ({ app, shell, openTab, testServer }) => {
  const icona = testServer.asset(Buffer.from(PNG_B64, 'base64'), 'image/png');
  const url = testServer.html(`<!doctype html><html><head><meta charset="utf-8"><title>Normale</title><link rel="icon" href="${icona}"></head><body>x</body></html>`);
  await openTab(url);
  await expect.poll(async () => (await sfondoIcona(shell)).some((s) => s.includes(`data:image/png;base64,${PNG_B64}`)), {
    timeout: 15000, message: 'la scheda doveva mostrare l\'icona del sito',
  }).toBe(true);
  // L'indirizzo dichiarato resta al main per archivio e salvati.
  const dichiarato = await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.tabs.find((t) => t.url === u)?.faviconUrl || '';
  }, url);
  expect(dichiarato).toBe(icona);
});

test('passando a un altro sito l\'icona di prima non resta sulla scheda mentre arriva quella nuova', async ({ app, shell }) => {
  const icone = await app.evaluate(({ BrowserWindow, session, net, nativeImage }) => {
    const png = (bgra) => nativeImage.createFromBitmap(Buffer.from(bgra), { width: 1, height: 1 }).toPNG();
    const rossa = png([0, 0, 255, 255]);
    const blu = png([255, 0, 0, 255]);
    session.defaultSession.protocol.handle('https', async (req) => {
      const u = new URL(req.url);
      if (!/^(primo|secondo)\.test$/.test(u.hostname)) return net.fetch(req, { bypassCustomProtocolHandlers: true });
      if (u.pathname === '/icona.png') {
        // L'icona del secondo sito arriva tardi: intanto la scheda è già sul secondo sito.
        if (u.hostname === 'secondo.test') await new Promise((r) => setTimeout(r, 3000));
        return new Response(u.hostname === 'primo.test' ? rossa : blu, { headers: { 'content-type': 'image/png' } });
      }
      return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${u.hostname}</title>`
        + '<link rel="icon" href="/icona.png"></head><body>x</body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.openTab('https://primo.test/');
    return { rossa: rossa.toString('base64'), blu: blu.toString('base64') };
  });
  const iconaDi = async (titolo) => shell.evaluate((t) => {
    // Mentre carica c'è la rotella al posto dell'icona: conta quello che si vede a caricamento finito.
    const ico = [...document.querySelectorAll('.tab')].find((x) => x.textContent.includes(t))?.querySelector('.favicon');
    return ico ? ico.style.backgroundImage : null;
  }, titolo);

  await expect.poll(() => iconaDi('primo.test'), { timeout: 15000 }).toContain(icone.rossa);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    tm.navigate(tm.tabs.find((t) => t.url === 'https://primo.test/').id, 'https://secondo.test/');
  });
  await expect.poll(() => iconaDi('secondo.test'), { timeout: 15000 }).not.toBeNull();
  expect(await iconaDi('secondo.test'), 'l\'icona del primo sito sul secondo dice il falso').not.toContain(icone.rossa);
  await expect.poll(() => iconaDi('secondo.test'), { timeout: 15000 }).toContain(icone.blu);
});
