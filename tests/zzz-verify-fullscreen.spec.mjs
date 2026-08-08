// SPEC DI VERIFICA INDIPENDENTE — creato dalla verifica, da rimuovere.
import { test, expect } from './fixtures/electron.mjs';

test('la finestra nascosta resta fuori schermo anche entrando/uscendo da fullscreen', async ({ app, shell }) => {
  const read = () => app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { b: w.getBounds(), fs: w.isFullScreen(), vis: w.isVisible() };
  });
  const before = await read();
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setFullScreen(true);
  });
  await new Promise((r) => setTimeout(r, 1500));
  const during = await read();
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setFullScreen(false);
  });
  await new Promise((r) => setTimeout(r, 1500));
  const after = await read();
  console.log('FS_PROBE=' + JSON.stringify({ before, during, after }));
  expect(before.b.x).toBeLessThan(-2000);
});
