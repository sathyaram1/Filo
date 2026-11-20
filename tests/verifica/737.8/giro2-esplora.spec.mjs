import { test, expect } from '../../fixtures/electron.mjs';

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const url = (t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } };
  const attiva = tm.tabs.find((t) => t.id === tm.activeId);
  return { attiva: attiva ? url(attiva) : '', schede: tm.tabs.map(url) };
});

for (const [forma, script] of [
  ['onload focus', '<body onload="window.focus()">'],
  ['focus subito', '<script>window.focus()</script>'],
  ['loop subito', '<script>setInterval(function(){window.focus()},150)</script>'],
  ['nessun focus', ''],
]) {
  test(`prima apertura con ${forma}`, async ({ app, openTab, testServer }) => {
    const aiuto = testServer.html(`<title>AIUTO</title>${script}<p>aiuto</p>`);
    const page = await openTab(testServer.html(`<button id="a" style="height:40px" onclick="window.open(${JSON.stringify(aiuto).replace(/"/g, '&quot;')},'aiuto','width=400,height=300')">aiuto</button>`));
    await page.click('#a');
    await expect.poll(async () => (await stato(app)).schede.includes(aiuto), { timeout: 8000 }).toBe(true);
    await page.waitForTimeout(1500);
    console.log(forma, JSON.stringify(await stato(app)));
    expect((await stato(app)).attiva).toBe(aiuto);
  });
}
