// #1066 giro 1 — la finestrella di accesso aperta col clic deve tenere il titolo col sito in vista: la pagina che
// sceglie posizione e misure non la può spingere fuori dallo schermo con la barra del titolo.
import { test, expect } from '../../fixtures/electron.mjs';

async function servi(app, pagine) {
  await app.evaluate(({ session, net }, pg) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', risposta);
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
  }, pagine);
}

const FINTA = 'https://login.sito-finto.it/login';

const finestrella = (app) => app.evaluate(({ BrowserWindow, screen }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && !x.isDestroyed() && x.webContents.getURL().includes('sito-finto'));
  if (!w) return null;
  const b = w.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  return { b, area };
});

for (const [nome, misure] of [
  ['sopra lo schermo', 'width=420,height=520,left=100,top=-400'],
  ['a sinistra e sopra', 'width=420,height=520,left=-2000,top=-2000'],
]) {
  test(`r1 la finestrella aperta ${nome} resta con la barra del titolo sullo schermo`, async ({ app, openTab, testServer }) => {
    await servi(app, { 'login.sito-finto.it/login': '<title>Accedi - Google</title><h1>Accedi</h1><input type="password">' });
    const page = await testServer.openReady(openTab, `<button id="b" style="width:220px;height:60px"
      onclick="window.open('${FINTA}','login','${misure}')">Accedi</button>`);
    await page.click('#b');
    await expect.poll(() => finestrella(app), { timeout: 8000 }).not.toBeNull();
    const { b, area } = await finestrella(app);
    expect(b.y, JSON.stringify({ b, area })).toBeGreaterThanOrEqual(area.y);
    expect(b.x + b.width, JSON.stringify({ b, area })).toBeGreaterThan(area.x);
  });
}
