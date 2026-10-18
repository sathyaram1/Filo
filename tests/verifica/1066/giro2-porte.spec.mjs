// #1066 giro 2 — porte ri-provate sulla finestrella di accesso: opzioni scritte storte, un clic per due finestre,
// il clic scaduto, il riquadro di un altro sito.
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

const finestrelle = (app) => app.evaluate(({ BrowserWindow, screen }) => BrowserWindow.getAllWindows()
  .filter((w) => !w._filoTabs && !w.isDestroyed() && /^(https?|about):/.test(w.webContents.getURL()))
  .map((w) => {
    const b = w.getBounds();
    const a = screen.getDisplayMatching(b).workArea;
    return {
      url: w.webContents.getURL(), titolo: w.getTitle(),
      dentro: b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height,
      chiudibile: w.isClosable(), spostabile: w.isMovable(), sopra: w.isAlwaysOnTop(),
    };
  }));

const FINTA = 'https://login.sito-finto.it/login';
const FINTA2 = 'https://auth.altro-finto.it/oauth/authorize';
const FINTA_HTML = '<title>Accedi - Google</title><h1>Accedi</h1>';

test('opzioni scritte con spazi e maiuscole non tolgono alla finestrella posto, chiusura e spostamento', async ({ app, openTab, testServer }) => {
  await servi(app, { 'login.sito-finto.it/login': FINTA_HTML });
  const misure = 'width=420 , height=520 , left=-900 , top=-900 , alwaysOnTop = yes , closable=no, movable=no, minWidth=6000, minHeight=6000';
  const page = await testServer.openReady(openTab, `<button id="b" style="width:220px;height:60px"
    onclick="window.open('${FINTA}','login','${misure}')">Accedi</button>`);
  await page.click('#b');
  await expect.poll(() => finestrelle(app), { timeout: 8000 }).toEqual([
    { url: FINTA, titolo: 'sito-finto.it', dentro: true, chiudibile: true, spostabile: true, sopra: false },
  ]);
});

test('un clic apre una finestrella sola', async ({ app, openTab, testServer }) => {
  await servi(app, { 'login.sito-finto.it/login': FINTA_HTML, 'auth.altro-finto.it/oauth/authorize': FINTA_HTML });
  const page = await testServer.openReady(openTab, `<button id="b" style="width:220px;height:60px"
    onclick="window.open('${FINTA}','a','width=420,height=520');window.open('${FINTA2}','b','width=420,height=520')">Accedi</button>`);
  await page.click('#b');
  await expect.poll(async () => (await finestrelle(app)).map((f) => f.url), { timeout: 8000 }).toEqual([FINTA]);
  await page.waitForTimeout(1500);
  expect((await finestrelle(app)).map((f) => f.url)).toEqual([FINTA]);
});

test('un clic vecchio di sei secondi non apre più la finestrella', async ({ app, openTab, testServer }) => {
  await servi(app, { 'login.sito-finto.it/login': FINTA_HTML });
  const page = await testServer.openReady(openTab, `<button id="b" style="width:220px;height:60px"
    onclick="setTimeout(function(){window.open('${FINTA}','a','width=420,height=520')},6500)">Leggi</button>`);
  await page.click('#b');
  await page.waitForTimeout(8500);
  expect(await finestrelle(app)).toEqual([]);
});
