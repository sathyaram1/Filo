// Verifica #592.6 — giro 10, rilievo 1. Una domanda di Filo dentro una finestrella di accesso: il sito
// rimpicciolisce la sua finestrella e il testo vero sparisce, mentre OK resta pronto a confermare.

import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina } from '../../helpers/confirm.mjs';

test('r1 il sito rimpicciolisce la finestrella di accesso con la domanda aperta: OK non conferma un testo che non si vede', async ({ app, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<h1>sito con «Accedi con…»</h1>');
  const segno = 'client_id=v592610';
  const login = `${testServer.html('<h1>accedi</h1>')}?${segno}&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await sito.evaluate((u) => { window.open(u, '_blank', 'width=480,height=600'); }, login);
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    if (!w) return 'no';
    try { return await w.webContents.executeJavaScript('document.documentElement.dataset.filoReady || "no"'); } catch (_) { return 'no'; }
  }, segno), { timeout: 15000 }).toBe('1');
  await app.evaluate(({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    w.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Filo vuole inviare agli sviluppatori il testo che hai scritto. ' + 'parole '.repeat(30) }); 1` }]);
  }, segno);
  const vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 700));
  // Il codice del sito, senza nessun gesto, rimpicciolisce e sposta la sua finestrella.
  await app.evaluate(async ({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    await w.webContents.executeJavaScript('window.resizeTo(260, 140); window.moveTo(0, 0); 1');
  }, segno);
  await new Promise((r) => setTimeout(r, 800));
  const s = await vista.evaluate(() => window.SN_CONFIRM_UI._test.state());
  // O il testo sta tutto nel riquadro, o OK aspetta che lo si faccia scorrere fino in fondo.
  expect(!s.textScrolls || s.okDisabled, `testo nascosto e OK pronto: ${JSON.stringify(s)}`).toBe(true);
});
