import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina } from '../../helpers/confirm.mjs';

test.setTimeout(60_000);

async function popupConDomanda(app, openTab, testServer, segno, misura) {
  const sito = await testServer.openReady(openTab, '<h1>sito</h1>');
  const login = `${testServer.html('<h1>accedi</h1>')}?${segno}&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await sito.evaluate(({ u, misura }) => { window.open(u, '_blank', misura); }, { u: login, misura });
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    if (!w) return 'no';
    try { return await w.webContents.executeJavaScript('document.documentElement.dataset.filoReady || "no"'); } catch (_) { return 'no'; }
  }, segno), { timeout: 15000 }).toBe('1');
  const prima = await bordi(app, segno);
  await app.evaluate(({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    w.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Filo vuole inviare agli sviluppatori il testo che hai scritto. FINE' }); 1` }]);
  }, segno);
  const vista = await confermaSopraPagina(app);
  return { vista, prima };
}

const bordi = (app, segno) => app.evaluate(({ BrowserWindow, screen }, segno) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
  return { b: w.getBounds(), c: w.getContentBounds(), area: screen.getDisplayMatching(w.getBounds()).workArea, tutti: screen.getAllDisplays().map((d) => d.bounds) };
}, segno);

test('fuori schermo a sinistra e in alto', async ({ app, openTab, testServer }) => {
  const { vista, prima } = await popupConDomanda(app, openTab, testServer, 'client_id=neg', 'popup,left=-300,top=-250,width=488,height=360');
  await new Promise((r) => setTimeout(r, 800));
  const dopo = await bordi(app, 'client_id=neg');
  const s = await vista.evaluate(() => window.SN_CONFIRM_UI._test.state());
  console.log('NEG', JSON.stringify({ prima, dopo, s }));
});

test('spostata con moveTo prima della domanda', async ({ app, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<h1>sito</h1>');
  const segno = 'client_id=mv';
  const login = `${testServer.html('<h1>accedi</h1>')}?${segno}&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await sito.evaluate(({ u }) => { window.open(u, '_blank', 'popup,width=488,height=360'); }, { u: login });
  await expect.poll(() => app.evaluate(({ BrowserWindow }, segno) => !!BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno)), segno)).toBe(true);
  await new Promise((r) => setTimeout(r, 800));
  await app.evaluate(async ({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    await w.webContents.executeJavaScript('window.moveTo(-300, -250); 1');
  }, segno);
  await new Promise((r) => setTimeout(r, 800));
  console.log('MV', JSON.stringify(await bordi(app, segno)));
});

test('angolo in basso a destra, piccola: allargata esce dallo schermo?', async ({ app, openTab, testServer }) => {
  const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  const left = area.x + area.width - 270;
  const top = area.y + area.height - 180;
  const { prima } = await popupConDomanda(app, openTab, testServer, 'client_id=ang', `popup,left=${left},top=${top},width=260,height=140`);
  await new Promise((r) => setTimeout(r, 800));
  console.log('ANG', JSON.stringify({ area, prima, dopo: await bordi(app, 'client_id=ang') }));
});
