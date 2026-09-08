// Sonda #514: schermo intero ed Esc in una finestra in incognito.
import { test, expect } from './fixtures/electron.mjs';

test('finestra in incognito: Esc esce dallo schermo intero', async ({ app, openTab }) => {
  await openTab('filo://manage/manage.html');
  const creata = await app.evaluate(() => {
    try {
      require('/home/user/Filo/src/main/window.js').createIncognitoWindow();
      return true;
    } catch (e) { return String(e && e.message); }
  });
  console.log('[sonda] incognito creata:', creata);

  const conta = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w._filoTabs).length);
  await expect.poll(conta, { timeout: 10000 }).toBeGreaterThan(1);

  const leggi = () => app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows().filter((w) => w._filoTabs);
    const win = wins[wins.length - 1];
    return { fs: win._filoTabs.contentFullscreen, nTab: win._filoTabs.tabs.length };
  });

  await app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows().filter((w) => w._filoTabs);
    wins[wins.length - 1]._filoTabs.toggleContentFullscreen();
  });
  await expect.poll(async () => (await leggi()).fs, { timeout: 8000 }).toBe(true);

  // Esc dalla pagina della scheda attiva dell'incognito, e poi dalla sua barra.
  await app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows().filter((w) => w._filoTabs);
    const win = wins[wins.length - 1];
    const tabs = win._filoTabs;
    const t = tabs.tabs.find((x) => x.id === tabs.activeId);
    const wc = t ? t.view.webContents : win.webContents;
    try { wc.focus(); } catch (_) {}
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await expect.poll(async () => (await leggi()).fs, { timeout: 8000 }).toBe(false);
});
