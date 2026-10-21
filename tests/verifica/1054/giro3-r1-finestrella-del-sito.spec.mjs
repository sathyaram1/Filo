// #1054 giro 3, rilievo 1: nella finestrella di accesso aperta da un sito il menu del tasto destro resta nel documento
// del sito anche con lo strato acceso.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

test.use({ stratoDelMenu: true });

const FINTA = 'https://login.sito-finto.it/login';

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

test('r1 la finestrella di accesso aperta da un sito non ha il menu nel suo documento', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
  await servi(app, { 'login.sito-finto.it/login': '<title>Accedi</title><body style="margin:20px"><input id="pw" type="password" style="width:200px"></body>' });
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:40px">
    <button id="b" style="width:200px;height:50px" onclick="window.open('${FINTA}', 'acc', 'width=500,height=400')">Accedi con</button></body>`);
  await page.locator('#b').click();
  let pop = null;
  await expect.poll(() => Boolean(pop = app.windows().find((w) => { try { return w.url() === FINTA; } catch (_) { return false; } })), { timeout: 8000 }).toBe(true);
  await pop.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await pop.locator('#pw').click({ button: 'right' });
  // Il menu compare (da qualche parte): poi si guarda dove.
  await expect.poll(async () => {
    // Lo strato della finestrella è suo, non quello della finestra principale.
    const strato = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .some((w) => [w._filoStrato, w._filoTabs && w._filoTabs.strato].some((s) => s && s.stato().aperto)));
    const nelSito = await pop.evaluate(() => document.documentElement.innerText.includes('Incolla'));
    return strato || nelSito;
  }, { timeout: 5000 }).toBe(true);
  // menu-dal-sito: lo script della pagina legge le voci del menu dal suo documento.
  expect(await pop.evaluate(() => document.documentElement.innerText), 'il menu di Filo sta nel documento del sito').not.toContain('Incolla');
});
