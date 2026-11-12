// Esplorazione: un'uscita da Filo (barra) subito dopo l'ingresso a schermo pieno chiesto dalla pagina.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = '<html><body style="margin:0"><div id="box" style="width:100px;height:100px;background:#09f"></div></body></html>';

for (let i = 0; i < 15; i++) {
  test(`uscita dalla barra appena entrati ${i}`, async ({ app, openTab, testServer }) => {
    await testServer.openReady(openTab, PAGINA);
    const r = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      const tabs = win._filoTabs;
      const wc = tabs.tabs.find((t) => t.id === tabs.activeId).view.webContents;
      await new Promise((res) => {
        wc.once('enter-html-full-screen', () => setImmediate(res));
        wc.executeJavaScript('document.getElementById("box").requestFullscreen().catch(()=>{}); true', true);
      });
      const fsAllIngresso = await wc.executeJavaScript('!!document.fullscreenElement');
      tabs.handleFullscreenEscape(null);
      return { fsAllIngresso };
    });
    await new Promise((r2) => setTimeout(r2, 2500));
    const dopo = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      const tabs = win._filoTabs;
      const wc = tabs.tabs.find((t) => t.id === tabs.activeId).view.webContents;
      return { content: tabs.contentFullscreen, page: tabs.pageFullscreen, win: win.isFullScreen(), doc: await wc.executeJavaScript('!!document.fullscreenElement') };
    });
    console.log('ESITO', i, JSON.stringify(r), JSON.stringify(dopo));
    expect(dopo).toEqual({ content: false, page: false, win: false, doc: false });
  });
}
