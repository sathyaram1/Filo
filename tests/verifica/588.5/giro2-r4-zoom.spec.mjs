// Esplorazione del giro 2 di #588.5: la pila della pagina sopra quella della barra, cambiando lo zoom con l'avviso aperto.
import { test, expect } from '../../fixtures/electron.mjs';

test('zoom cambiato con l’avviso aperto: la pila della pagina resta sopra quella della barra', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0"><p>pagina</p></body></html>');
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  const misura = () => app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    const r = await wc.executeJavaScript(`(() => {
      let h = document.querySelector('.sn-toasts');
      if (!h) { h = document.createElement('div'); h.className = 'sn-toasts'; h.innerHTML = '<div style="width:200px;height:40px;background:red;pointer-events:auto">toast</div>'; document.documentElement.appendChild(h); }
      const b = h.getBoundingClientRect();
      return { fondoCss: innerHeight - b.bottom, varCss: getComputedStyle(document.documentElement).getPropertyValue('--filo-avvisi-barra') };
    })()`);
    return { ...r, zoom: wc.getZoomFactor(), barra: tm.avvisi.vista.getBounds().height };
  });
  await expect.poll(async () => { const m = await misura(); return m.fondoCss * m.zoom >= m.barra - 1; }).toBe(true);
  console.log('prima', JSON.stringify(await misura()));
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.tabs.find((t) => t.id === tm.activeId).view.webContents.setZoomFactor(0.5);
  });
  await new Promise((r) => setTimeout(r, 1500));
  const m = await misura();
  console.log('dopo zoom 50%', JSON.stringify(m));
  expect(m.fondoCss * m.zoom).toBeGreaterThanOrEqual(m.barra - 1);
});
