// Esplorazione giro 12: aspetto del popup sopra la scheda (chiaro, scuro) e domanda con la pagina a tutto schermo.
import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

const chiedi = (app, host, testo) => nelMondoDiFilo(app, host, `(() => { globalThis.__l = null; SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: ${JSON.stringify(testo)} }).then((ok) => { globalThis.__l = ok; }); return 1; })()`);

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, openTab, testServer }) => {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    const page = await testServer.openReady(openTab, '<body style="background:#fff;font:18px sans-serif"><h1>Ricette</h1><p>Testo della pagina sotto il velo.</p></body>');
    const host = new URL(page.url()).hostname;
    await chiedi(app, host, 'Filo vuole impostare: Tema → Scuro.');
    const vista = await confermaSopraPagina(app);
    await new Promise((r) => setTimeout(r, 900));
    await vista.screenshot({ path: `tests/.shots/592.6-g12-${tema}.png` });
    const b = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const tm = w._filoTabs;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      return { vista: tm.conferme.vista.getBounds(), scheda: t.view.getBounds() };
    });
    expect(b.vista).toEqual(b.scheda);
  });
}

test('pagina a tutto schermo: la domanda copre la scheda intera', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<body style="background:#fff"><button id="fs" onclick="document.documentElement.requestFullscreen()">schermo</button></body>');
  const host = new URL(page.url()).hostname;
  await page.click('#fs');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await new Promise((r) => setTimeout(r, 800));
  await chiedi(app, host, 'Filo vuole impostare: Tema → Scuro.');
  const vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 900));
  const b = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    const figli = w.contentView.children;
    return { vista: tm.conferme.vista.getBounds(), scheda: t.view.getBounds(), cima: figli[figli.length - 1] === tm.conferme.vista || figli.indexOf(tm.conferme.vista) > figli.indexOf(t.view), win: w.getContentBounds() };
  });
  console.log(JSON.stringify(b));
  await vista.screenshot({ path: 'tests/.shots/592.6-g12-fs.png' });
  expect(b.vista).toEqual(b.scheda);
  expect(b.cima).toBe(true);
  // Esc mentre la domanda è a schermo: annulla la domanda.
  await vista.keyboard.press('Escape');
  await expect.poll(() => nelMondoDiFilo(app, host, 'globalThis.__l')).toBe(false);
  console.log('fs dopo esc', await page.evaluate(() => !!document.fullscreenElement));
});
