// Verifica #838 giro 2, rilievo 1: il menu che si apre col tasto destro sulla
// linguetta prende la tastiera, ma Esc non lo chiude.
import { test, expect } from '../../fixtures/electron.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const menuAperto = (app) => app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().startsWith('data:text/html')));

test('Esc chiude il menu della linguetta', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<p>una pagina</p>');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
  });
  const box = await shell.evaluate(() => {
    const r = document.querySelector('.tab.active').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await shell.mouse.click(box.x, box.y, { button: 'right' });
  await expect.poll(() => menuAperto(app), { timeout: 5000 }).toBe(true);
  await pausa(300);
  // Esc come un tasto vero, sul menu che ha la tastiera.
  await app.evaluate(({ BrowserWindow }) => {
    const m = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('data:text/html'));
    m.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    m.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await expect.poll(() => menuAperto(app), { timeout: 3000 }).toBe(false);
});
