import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

test.setTimeout(90_000);

for (const tema of ['light', 'dark']) {
  test(`esplora aspetto ${tema}`, async ({ app, openTab, testServer }) => {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.setSettings?.({ theme: t }); }, tema).catch(() => {});
    const page = await testServer.openReady(openTab, '<h1>Ricette della nonna</h1><p>' + 'Testo della pagina. '.repeat(80) + '</p>');
    const host = new URL(page.url()).hostname;
    await nelMondoDiFilo(app, host, `(() => { SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Filo vuole impostare: Tema → Scuro.' }); return 1; })()`);
    const vista = await confermaSopraPagina(app);
    await new Promise((r) => setTimeout(r, 800));
    await vista.screenshot({ path: `tests/.shots/592.6-g8-vista-${tema}.png` });
    await page.screenshot({ path: `tests/.shots/592.6-g8-pagina-${tema}.png` });
    const geo = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const tm = w._filoTabs;
      return { vista: tm.conferme.vista.getBounds(), scheda: tm.tabs.find((t) => t.id === tm.activeId).view.getBounds(), win: w.getContentBounds() };
    });
    console.log(tema, JSON.stringify(geo));
    expect(1).toBe(1);
  });
}
