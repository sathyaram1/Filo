// #1868 giro 2: la rimessa in piedi della scheda caduta copre anche Ricarica e Indietro chiesti subito dopo il crollo.
import { test, expect } from '../../fixtures/electron.mjs';

async function crollaE(app, target, gesto, verso) {
  await app.evaluate(async ({ BrowserWindow }, [t, g, v]) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tab = w._filoTabs.tabs.find((x) => x.view.webContents.getURL() === t);
    const wc = tab.view.webContents;
    process.kill(wc.getOSProcessId(), 'SIGKILL');
    for (let i = 0; i < 200 && !wc.isCrashed(); i++) await new Promise((r) => setTimeout(r, 10));
    if (g === 'reload') w._filoTabs.reload(tab.id);
    else if (g === 'back') w._filoTabs.goBack(tab.id);
    else w._filoTabs.navigate(tab.id, v);
  }, [target, gesto, verso]);
  await new Promise((r) => setTimeout(r, 2500));
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.tabs.map((t) => t.view.webContents.getURL());
  });
}

test('r1 ricaricare subito dopo il crollo della scheda ricarica il sito, non la pagina della scheda caduta', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<!DOCTYPE html><title>viva</title><p>contenuto</p>');
  await openTab(url);
  const urls = await crollaE(app, url, 'reload');
  expect(urls).toContain(url);
});

test('r1 Indietro subito dopo il crollo della scheda torna alla pagina prima, non alla pagina della scheda caduta', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!DOCTYPE html><title>a</title><p>a</p>');
  const b = testServer.html('<!DOCTYPE html><title>b</title><p>b</p>');
  await openTab(a);
  await app.evaluate(({ BrowserWindow }, [a, b]) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tab = w._filoTabs.tabs.find((x) => x.view.webContents.getURL() === a);
    w._filoTabs.navigate(tab.id, b);
  }, [a, b]);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.tabs.map((t) => t.view.webContents.getURL()))).toContain(b);
  const urls = await crollaE(app, b, 'back');
  expect(urls).toContain(a);
});
