// Esplorazione del giro 10 (#592.6): aspetto del popup sopra la scheda e popup di accesso rimpicciolito dal sito.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

const SHOTS = path.join(process.cwd(), 'tests', '.shots');

async function cattura(app, nome) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const img = await w.capturePage();
    return img.toPNG().toString('base64');
  });
  fs.writeFileSync(path.join(SHOTS, nome), Buffer.from(b64, 'base64'));
}

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, openTab, testServer }) => {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    const page = await testServer.openReady(openTab, '<body style="margin:0;font:18px sans-serif;background:#f4efe6"><h1>Ricette della nonna</h1><p>' + 'testo della pagina '.repeat(200) + '</p></body>');
    const host = new URL(page.url()).hostname;
    await nelMondoDiFilo(app, host, `(() => { SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Filo vuole inviare un feedback agli sviluppatori: «Il tasto indietro non funziona su questa pagina».' }); return 1; })()`);
    await confermaSopraPagina(app);
    await new Promise((r) => setTimeout(r, 900));
    await cattura(app, `giro10-${tema}.png`);
  });
}

test('popup di accesso rimpicciolito dal sito con la domanda aperta', async ({ app, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<h1>sito</h1>');
  const segno = 'client_id=v592610';
  const login = `${testServer.html('<h1>accedi</h1>')}?${segno}&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await sito.evaluate((u) => { window.open(u, '_blank', 'width=480,height=600'); }, login);
  const trova = `BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(${JSON.stringify(segno)}))`;
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    if (!w) return 'no';
    try { return await w.webContents.executeJavaScript('document.documentElement.dataset.filoReady || "no"'); } catch (_) { return 'no'; }
  }, segno), { timeout: 15000 }).toBe('1');
  void trova;
  await app.evaluate(({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    w.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `SN_CONFIRM_UI.confirm({ title: 'Dal popup', text: 'Filo vuole impostare: Tema → Scuro. ' + 'parole '.repeat(30) }); 1` }]);
  }, segno);
  const vista = await confermaSopraPagina(app);
  // Il sito, nella sua finestrella, si rimpicciolisce.
  const dopo = await app.evaluate(async ({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    await w.webContents.executeJavaScript('window.resizeTo(260, 140); window.moveTo(0, 0); 1');
    await new Promise((r) => setTimeout(r, 800));
    const figli = w.contentView.children || [];
    const v = figli[figli.length - 1];
    return { size: w.getContentSize(), bounds: v && v.getBounds(), pos: w.getPosition() };
  }, segno);
  const s = await vista.evaluate(() => window.SN_CONFIRM_UI._test.state());
  console.log('POPUP', JSON.stringify(dopo), JSON.stringify(s));
  const b64 = await app.evaluate(async ({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    return (await w.capturePage()).toPNG().toString('base64');
  }, segno);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, 'giro10-popup-piccolo.png'), Buffer.from(b64, 'base64'));
});
