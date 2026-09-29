import { test, expect } from '../../fixtures/electron.mjs';
test('clic in un riquadro di un altro sito: il gesto arriva?', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<body style="margin:0;background:#cfc"><h2 id="d" style="height:200px">riquadro</h2></body>');
  const pagina = await testServer.openReady(openTab, `<h1>fuori</h1><iframe id="f" src="${dentro}" style="width:400px;height:250px;border:0"></iframe>`, { pubblico: true });
  await pagina.waitForTimeout(1000);
  const leggi = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    const wc = t.view.webContents;
    return { g: wc._filoGestoAlle || 0, frames: wc.mainFrame.framesInSubtree.map((f) => [f.url, f.processId]) };
  });
  const prima = await leggi();
  const fr = pagina.frameLocator('#f');
  await fr.locator('#d').click();
  const dopo = await leggi();
  console.log(JSON.stringify(prima), JSON.stringify(dopo));
  expect(dopo.g).toBeGreaterThan(prima.g);
});
