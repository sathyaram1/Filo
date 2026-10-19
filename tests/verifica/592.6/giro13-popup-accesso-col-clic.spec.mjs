// Verifica #592.6 — giro 13, dopo il riallineamento: il caso del popup di accesso del giro 1, con la finestrella
// aperta da un clic vero come vuole il blocco dei popup arrivato da main (#737.1). Porta ri-provata e chiusa.

import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina } from '../../helpers/confirm.mjs';

test('popup di accesso aperto col clic: la domanda compare sopra la sua finestra e la risposta arriva', async ({ app, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<h1>sito con «Accedi con…»</h1>');
  const segno = 'client_id=v592613';
  const login = `${testServer.html('<h1>accedi</h1>')}?${segno}&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await sito.mouse.click(5, 5);
  await sito.evaluate((u) => { window.open(u, '_blank', 'width=480,height=600'); }, login);
  const delPopup = (fn, extra) => app.evaluate(async ({ BrowserWindow }, { segno, fn, extra }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    return new Function('w', 'extra', `return (${fn})(w, extra)`)(w, extra);
  }, { segno, fn: fn.toString(), extra });
  await expect.poll(() => delPopup(async (w) => {
    if (!w) return 'no';
    try { return await w.webContents.executeJavaScript('document.documentElement.dataset.filoReady || "no"'); } catch (_) { return 'no'; }
  }), { timeout: 15000 }).toBe('1');
  await delPopup((w) => {
    w.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `globalThis.__p = null; SN_CONFIRM_UI.confirm({ title: 'Dal popup', text: 'domanda' }).then((ok) => { globalThis.__p = ok; }); 1` }]);
  });
  const vista = await confermaSopraPagina(app);
  const info = await delPopup((w) => {
    const figli = w.contentView.children || [];
    const v = figli[figli.length - 1];
    return { bounds: v && v.getBounds(), size: w.getContentSize() };
  });
  expect(info.bounds).toEqual({ x: 0, y: 0, width: info.size[0], height: info.size[1] });
  await new Promise((r) => setTimeout(r, 700));
  const p = await vista.evaluate((w) => window.SN_CONFIRM_UI._test.point(w), 'ok');
  expect(p).toBeTruthy();
  await vista.mouse.click(p.x, p.y);
  await expect.poll(() => delPopup((w) => w.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.__p' }]))).toBe(true);
});
