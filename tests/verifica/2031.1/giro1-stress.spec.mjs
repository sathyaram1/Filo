// Esplorazione #2031.1 giro 1: inviti ripetuti e Crediti già fra le schede salvate, con la finestra che rinasce.

import { test, expect } from '../../fixtures/electron.mjs';

const normale = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
  if (!w) return null;
  const tm = w._filoTabs;
  const url = (t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } };
  const davanti = tm.tabs.find((t) => t.id === tm.activeId);
  return { schede: tm.tabs.map(url), davanti: davanti ? url(davanti) : null };
});

const salvate = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
  return (s && s.tabs) || [];
});

async function chiudi(app, shell, openTab, testServer, conCrediti) {
  if (conCrediti) await openTab('filo://credits/credits.html');
  const a = (await openTab(testServer.html('<title>A</title><h1>A</h1>'))).url();
  await expect.poll(() => salvate(app), { timeout: 10000 }).toEqual(expect.arrayContaining([a]));
  await shell.evaluate(() => window.filoShell.openIncognito());
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(() => normale(app), { timeout: 10000 }).toBeNull();
  return a;
}

const crediti = (s) => (s?.schede || []).filter((u) => u.startsWith('filo://credits/')).length;

test('due inviti di fila sulla finestra che rinasce: una sola Crediti, davanti', async ({ app, shell, openTab, testServer }) => {
  const a = await chiudi(app, shell, openTab, testServer, false);
  await app.evaluate(({ app: x }) => {
    x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd());
    x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd());
  });
  await expect.poll(async () => (await normale(app))?.schede || [], { timeout: 15000 })
    .toEqual(expect.arrayContaining([a, expect.stringMatching(/^filo:\/\/credits\//)]));
  await new Promise((r) => setTimeout(r, 1000));
  const s = await normale(app);
  expect(s.davanti).toMatch(/^filo:\/\/credits\//);
  expect(crediti(s)).toBe(1);
});

test('Crediti già fra le schede salvate, dietro: l\'invito la porta davanti senza doppione', async ({ app, shell, openTab, testServer }) => {
  const a = await chiudi(app, shell, openTab, testServer, true);
  await app.evaluate(({ app: x }) => { x.emit('open-url', { preventDefault() {} }, 'filo://invito/ABCD'); });
  await expect.poll(async () => (await normale(app))?.schede || [], { timeout: 15000 })
    .toEqual(expect.arrayContaining([a, expect.stringMatching(/^filo:\/\/credits\//)]));
  await new Promise((r) => setTimeout(r, 1000));
  const s = await normale(app);
  expect(s.davanti).toMatch(/^filo:\/\/credits\//);
  expect(crediti(s)).toBe(1);
});
