import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, openTab, testServer }) => {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    const page = await testServer.openReady(openTab, '<body style="background:#f5f0e6;font:16px sans-serif"><h1>Ricette della nonna</h1><p>' + 'testo della pagina '.repeat(80) + '</p></body>');
    const host = new URL(page.url()).hostname;
    await nelMondoDiFilo(app, host, `(() => { SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Filo vuole impostare: Tema → Scuro.' }); return 1; })()`);
    const vista = await confermaSopraPagina(app);
    await new Promise((r) => setTimeout(r, 900));
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const img = await w.webContents.capturePage();
      return img.toPNG().toString('base64');
    });
    await vista.screenshot({ path: `tests/.shots/v5926-g12-vista-${tema}.png` });
    await page.screenshot({ path: `tests/.shots/v5926-g12-pagina-${tema}.png` });
    expect(png.length).toBeGreaterThan(0);
  });
}
