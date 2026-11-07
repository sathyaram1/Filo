// Verifica #2031.1 giro 1: l'invito aperto da fuori con Filo acceso senza finestra principale, nelle sequenze insolite.

import { test, expect } from '../../fixtures/electron.mjs';

const normale = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
  if (!w) return null;
  const tm = w._filoTabs;
  const url = (t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } };
  const davanti = tm.tabs.find((t) => t.id === tm.activeId);
  return { schede: tm.tabs.map(url), davanti: davanti ? url(davanti) : null, visibile: w.isVisible(), minimizzata: w.isMinimized() };
});

const sessioneSalvata = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
  return (s && s.tabs) || [];
});

const errori = (app) => app.evaluate(() => globalThis.__errori20311 || []);

async function chiudiLaPrincipale(app, shell, openTab, testServer) {
  await app.evaluate(() => {
    globalThis.__errori20311 = [];
    process.on('uncaughtException', (e) => globalThis.__errori20311.push(String((e && e.stack) || e)));
  });
  const a = (await openTab(testServer.html('<title>A</title><h1>A</h1>'))).url();
  const b = (await openTab(testServer.html('<title>B</title><h1>B</h1>'))).url();
  await expect.poll(() => sessioneSalvata(app), { timeout: 10000 }).toEqual(expect.arrayContaining([a, b]));
  await shell.evaluate(() => window.filoShell.openIncognito());
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(() => normale(app), { timeout: 10000 }).toBeNull();
  return { a, b };
}

const crediti = (s) => (s?.schede || []).filter((u) => u.startsWith('filo://credits/')).length;

async function creditiDavantiStabile(app, a, b, perche) {
  await expect.poll(async () => (await normale(app))?.schede || [], { message: perche, timeout: 15000 })
    .toEqual(expect.arrayContaining([a, b, expect.stringMatching(/^filo:\/\/credits\//)]));
  await new Promise((r) => setTimeout(r, 1500));
  const s = await normale(app);
  expect(s.davanti, perche + ': Crediti non è davanti').toMatch(/^filo:\/\/credits\//);
  expect(s.visibile, perche + ': la finestra non si vede').toBe(true);
  return s;
}

test('doppio clic sull\'invito da fuori: Crediti davanti, una sola volta', async ({ app, shell, openTab, testServer }) => {
  const { a, b } = await chiudiLaPrincipale(app, shell, openTab, testServer);
  await app.evaluate(({ app: x }) => {
    x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd());
    x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd());
  });
  const s = await creditiDavantiStabile(app, a, b, 'doppio invito');
  expect(crediti(s), 'Crediti aperta più volte').toBe(1);
  expect(await errori(app)).toEqual([]);
});

test('icona di Filo e subito dopo l\'invito, prima che le schede tornino: Crediti davanti', async ({ app, shell, openTab, testServer }) => {
  const { a, b } = await chiudiLaPrincipale(app, shell, openTab, testServer);
  await app.evaluate(({ app: x }) => {
    x.emit('second-instance', {}, ['filo.exe', '.'], process.cwd());
    setTimeout(() => x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()), 30);
  });
  await creditiDavantiStabile(app, a, b, 'icona poi invito');
  expect(await errori(app)).toEqual([]);
});

test('su Mac Dock e subito dopo l\'invito: Crediti davanti', async ({ app, shell, openTab, testServer }) => {
  const { a, b } = await chiudiLaPrincipale(app, shell, openTab, testServer);
  await app.evaluate(({ app: x }) => {
    x.emit('activate', {}, true);
    x.emit('open-url', { preventDefault() {} }, 'filo://invito/ABCD');
  });
  await creditiDavantiStabile(app, a, b, 'Dock poi invito');
  expect(await errori(app)).toEqual([]);
});

test('finestra minimizzata: l\'invito da fuori la riporta su con Crediti davanti', async ({ app, shell, openTab, testServer }) => {
  const a = (await openTab(testServer.html('<title>A</title><h1>A</h1>'))).url();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito).minimize();
  });
  await app.evaluate(({ app: x }) => { x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()); });
  await expect.poll(async () => (await normale(app))?.davanti, { timeout: 10000 }).toMatch(/^filo:\/\/credits\//);
  const s = await normale(app);
  expect(s.schede).toContain(a);
  expect(s.minimizzata, 'la finestra resta minimizzata').toBe(false);
});

test('invito da fuori e la finestra rinata richiusa subito: niente errori, al giro dopo Crediti davanti', async ({ app, shell, openTab, testServer }) => {
  const { a, b } = await chiudiLaPrincipale(app, shell, openTab, testServer);
  await app.evaluate(({ app: x, BrowserWindow }) => {
    x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd());
    const w = BrowserWindow.getAllWindows().find((y) => !y.isDestroyed() && y._filoTabs && !y._filoIncognito);
    if (w) w.close();
  });
  await expect.poll(() => normale(app), { timeout: 10000 }).toBeNull();
  await new Promise((r) => setTimeout(r, 1000));
  expect(await errori(app)).toEqual([]);
  expect(await sessioneSalvata(app), 'la sessione si è persa').toEqual(expect.arrayContaining([a, b]));
  await app.evaluate(({ app: x }) => { x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()); });
  await creditiDavantiStabile(app, a, b, 'secondo invito');
  expect(await errori(app)).toEqual([]);
});
