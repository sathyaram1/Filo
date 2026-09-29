// Sonda esplorativa (si cancella): chi ha la tastiera dopo vari gesti.
import { test, expect } from '../../fixtures/electron.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const chiHaFuoco = (app) => app.evaluate(({ BrowserWindow, webContents }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const f = webContents.getFocusedWebContents();
  if (!f) return 'nessuno';
  if (f === w.webContents) return 'barra';
  const t = w._filoTabs.tabs.find((x) => x.view.webContents === f);
  if (t) return t.id === w._filoTabs.activeId ? 'scheda-attiva' : 'scheda-nascosta';
  return 'altro:' + f.getURL().slice(0, 40);
});

function premi(app, keyCode, modifiers) {
  return app.evaluate(({ webContents }, { keyCode, modifiers }) => {
    const f = webContents.getFocusedWebContents();
    if (!f) return false;
    f.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    f.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    return true;
  }, { keyCode, modifiers });
}

const aiutoSullaAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t.view.webContents.executeJavaScript('!!document.querySelector(".sn-sidebar")');
});

test('avvio: dopo show e focus della finestra', async ({ app, shell }) => {
  await pausa(1500);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
  });
  await pausa(800);
  console.log('AVVIO fuoco:', await chiHaFuoco(app));
});

test('finestra lasciata e ripresa', async ({ app, openTab, testServer }) => {
  for (let i = 1; i <= 2; i++) await testServer.openReady(openTab, `<p>pagina ${i}</p>`);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.focus();
  });
  await pausa(400);
  console.log('PRIMA:', await chiHaFuoco(app));
  await app.evaluate(({ BrowserWindow }) => {
    const altra = new BrowserWindow({ width: 300, height: 200, show: true });
    globalThis.__altra = altra;
    altra.loadURL('data:text/html,<input autofocus>');
    altra.focus();
  });
  await pausa(800);
  console.log('ALTRA DAVANTI:', await chiHaFuoco(app));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.focus();
  });
  await pausa(800);
  console.log('RIPRESA:', await chiHaFuoco(app));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.minimize();
  });
  await pausa(600);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.restore(); w.focus();
  });
  await pausa(800);
  console.log('DOPO MINIMIZZA:', await chiHaFuoco(app));
});

test('chiusura dal menu della linguetta', async ({ app, shell, openTab, testServer }) => {
  for (let i = 1; i <= 3; i++) await testServer.openReady(openTab, `<p>pagina ${i}</p>`);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.focus();
  });
  await pausa(400);
  console.log('PRIMA:', await chiHaFuoco(app));
  // Tasto destro vero sulla linguetta attiva.
  const box = await shell.evaluate(() => {
    const el = document.querySelector('.tab.active, [data-active="true"], .tab[aria-selected="true"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, cls: el.className };
  });
  console.log('LINGUETTA:', JSON.stringify(box));
  await shell.mouse.click(box.x, box.y, { button: 'right' });
  await pausa(1200);
  console.log('MENU APERTO:', await chiHaFuoco(app));
  const menu = app.windows().find((p) => p.url().startsWith('data:text/html'));
  const voci = await menu.evaluate(() => [...document.querySelectorAll('*')].filter((e) => /Chiudi/.test(e.textContent) && e.children.length < 3).map((e) => e.tagName + '.' + e.className).slice(0, 5));
  console.log('VOCI:', voci);
  const pos = await menu.evaluate(() => {
    const el = [...document.querySelectorAll('[data-action], .item, button, li, div')].reverse().find((e) => e.textContent.trim() === 'Chiudi');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const n0 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs.length);
  await menu.mouse.click(pos.x, pos.y);
  await pausa(1500);
  const n1 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs.length);
  console.log('SCHEDE', n0, '->', n1, 'FUOCO DOPO:', await chiHaFuoco(app));
  const ok = await premi(app, 'H', ['alt']);
  await pausa(1500);
  console.log('PREMUTO', ok, 'AIUTO:', await aiutoSullaAttiva(app));
});
