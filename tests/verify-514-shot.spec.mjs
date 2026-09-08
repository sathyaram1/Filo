// #514 — traccia visiva: la finestra a tutto schermo e la stessa dopo Esc.
import { test } from './fixtures/electron.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

test('traccia visiva del tutto schermo e del ritorno', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1500);
  mkdirSync('tests/.shots', { recursive: true });

  const scatta = async (nome) => {
    const b64 = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      try { win.setOpacity(1); } catch (_) {}
      const img = await win.capturePage();
      try { win.setOpacity(0); } catch (_) {}
      return img.toPNG().toString('base64');
    });
    writeFileSync(`tests/.shots/514-${nome}.png`, Buffer.from(b64, 'base64'));
  };

  await scatta('1-normale');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.toggleContentFullscreen();
  });
  await page.waitForTimeout(1500);
  await scatta('2-tutto-schermo');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const wc = tabs.tabs.find((t) => t.id === tabs.activeId).view.webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await page.waitForTimeout(1500);
  await scatta('3-dopo-esc');
});
