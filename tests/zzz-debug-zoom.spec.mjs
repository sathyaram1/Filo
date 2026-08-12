import { test, expect } from './fixtures/electron.mjs';

test('debug shell zoom key', async ({ app, shell, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');

  // Instrumenta: conta before-input-event sulla shell e send verso la tab.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    global.__dbg = { inputs: [], hasTabs: !!win._filoTabs, activeId: win._filoTabs && win._filoTabs.activeId };
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown') global.__dbg.inputs.push({ k: input.key, c: input.code, ctrl: input.control });
    });
  });

  await shell.bringToFront();
  await shell.keyboard.press('Control+=');
  await new Promise((r) => setTimeout(r, 500));

  const dbg = await app.evaluate(() => global.__dbg);
  console.log('DBG', JSON.stringify(dbg));

  // La pagina riceve l'ipc?
  const got = await page.evaluate(() => {
    return new Promise((res) => {
      let n = 0;
      try { require('electron').ipcRenderer.on('filo:zoom-key', () => { n++; }); } catch (e) { return res('no-ipc:' + e.message); }
      setTimeout(() => res('listeners-ok n=' + n), 100);
    });
  }).catch((e) => 'evalfail:' + e.message);
  console.log('PAGE', got);
});
