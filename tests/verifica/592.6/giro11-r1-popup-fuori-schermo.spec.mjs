// Giro 11, rilievo 1: una domanda dentro una finestrella di accesso deve stare tutta sullo schermo. Il sito apre la
// finestrella in parte fuori dallo schermo (posizione chiesta nell'apertura) e resta in vista solo OK.
import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina } from '../../helpers/confirm.mjs';

test.setTimeout(60_000);

async function popupConDomanda(app, openTab, testServer, segno, misura) {
  const sito = await testServer.openReady(openTab, '<h1>sito con «Accedi con…»</h1>');
  const login = `${testServer.html('<h1>accedi</h1>')}?${segno}&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await sito.evaluate(({ u, misura }) => { window.open(u, '_blank', misura); }, { u: login, misura });
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    if (!w) return 'no';
    try { return await w.webContents.executeJavaScript('document.documentElement.dataset.filoReady || "no"'); } catch (_) { return 'no'; }
  }, segno), { timeout: 15000 }).toBe('1');
  await app.evaluate(({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    w.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Filo vuole inviare agli sviluppatori il testo che hai scritto. FINE' }); 1` }]);
  }, segno);
  const vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 800));
  const ok = await vista.evaluate(() => window.SN_CONFIRM_UI._test.point('ok'));
  const g = await app.evaluate(({ BrowserWindow, screen }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    const c = w.getContentBounds();
    return { c, area: screen.getDisplayMatching(c).workArea };
  }, segno);
  return { ...g, okSchermo: { x: g.c.x + ok.x, y: g.c.y + ok.y } };
}

const dentro = (c, a) => c.x >= a.x && c.y >= a.y && c.x + c.width <= a.x + a.width && c.y + c.height <= a.y + a.height;

test('r1 finestrella aperta oltre il bordo sinistro: con la domanda torna tutta sullo schermo', async ({ app, openTab, testServer }) => {
  const g = await popupConDomanda(app, openTab, testServer, 'client_id=sx', 'popup,left=-330,top=200,width=488,height=360');
  // La truffa: OK si vede e si preme, il titolo e quasi tutto il testo stanno oltre il bordo.
  expect(dentro(g.c, g.area), JSON.stringify(g)).toBe(true);
});

test('r1 finestrella piccola nell’angolo in basso a destra: allargata per la domanda non esce dallo schermo', async ({ app, openTab, testServer }) => {
  const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  const left = area.x + area.width - 270;
  const top = area.y + area.height - 180;
  const g = await popupConDomanda(app, openTab, testServer, 'client_id=ang', `popup,left=${left},top=${top},width=260,height=140`);
  expect(dentro(g.c, g.area), JSON.stringify(g)).toBe(true);
});
