// Verifica #2031.1 giro 1: l'invito aperto da fuori con Filo senza finestra principale, coi casi che la prova del lavoro non copre.

import { test, expect } from '../../fixtures/electron.mjs';

const normale = (app) => app.evaluate(async ({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
  if (!w) return null;
  const tm = w._filoTabs;
  const url = (t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } };
  const davanti = tm.tabs.find((t) => t.id === tm.activeId);
  let nota = null;
  try {
    const wc = davanti && davanti.view && davanti.view.webContents;
    if (wc && !wc.isLoading() && /^filo:\/\/credits\//.test(wc.getURL())) {
      nota = await wc.executeJavaScript("(() => { const n = document.getElementById('walletNote'); return n && !n.hidden ? n.textContent : null; })()");
    }
  } catch (_) {}
  return { schede: tm.tabs.map(url), davanti: davanti ? url(davanti) : null, visibile: w.isVisible(), nota };
});

const sessioneSalvata = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
  return (s && s.tabs) || [];
});

async function chiudiLaPrincipale(app, shell) {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(() => normale(app), { timeout: 10000 }).toBeNull();
}

const crediti = (s) => (s?.schede || []).filter((u) => u.startsWith('filo://credits/')).length;

test('Crediti già fra le schede salvate, non davanti: l\'invito da fuori la porta davanti, una sola, con l\'esito', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito)._filoTabs.openTab('filo://credits/credits.html', { activate: true });
  });
  const a = (await openTab(testServer.html('<title>A</title><h1>A</h1>'))).url();
  await expect.poll(() => sessioneSalvata(app), { timeout: 10000 })
    .toEqual(expect.arrayContaining([a, expect.stringMatching(/^filo:\/\/credits\//)]));
  await chiudiLaPrincipale(app, shell);
  await app.evaluate(({ app: x }) => { x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()); });
  await expect.poll(async () => (await normale(app))?.schede || [], { timeout: 15000 })
    .toEqual(expect.arrayContaining([a, expect.stringMatching(/^filo:\/\/credits\//)]));
  await new Promise((r) => setTimeout(r, 1500));
  const s = await normale(app);
  expect(s.davanti, 'Crediti non è davanti').toMatch(/^filo:\/\/credits\//);
  expect(crediti(s), 'Crediti aperta due volte').toBe(1);
  expect(s.visibile).toBe(true);
  await expect.poll(async () => (await normale(app))?.nota, { message: 'la pagina Crediti non dice l\'esito del riscatto', timeout: 20000 })
    .toBeTruthy();
});

test('invito da fuori senza finestra: la pagina Crediti davanti dice l\'esito del riscatto', async ({ app, shell, openTab, testServer }) => {
  const a = (await openTab(testServer.html('<title>A</title><h1>A</h1>'))).url();
  await expect.poll(() => sessioneSalvata(app), { timeout: 10000 }).toEqual(expect.arrayContaining([a]));
  await chiudiLaPrincipale(app, shell);
  await app.evaluate(({ app: x }) => { x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()); });
  await expect.poll(async () => (await normale(app))?.davanti, { timeout: 15000 }).toMatch(/^filo:\/\/credits\//);
  await expect.poll(async () => (await normale(app))?.nota, { message: 'la pagina Crediti non dice l\'esito del riscatto', timeout: 20000 })
    .toBeTruthy();
  const s = await normale(app);
  expect(s.schede).toContain(a);
  expect(s.davanti).toMatch(/^filo:\/\/credits\//);
});
