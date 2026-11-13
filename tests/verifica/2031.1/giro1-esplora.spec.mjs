// Verifica #2031.1 giro 1: l'invito aperto da fuori con Filo senza finestra principale porta Crediti davanti.

import { test, expect } from '../../fixtures/electron.mjs';

const normale = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
  if (!w) return null;
  const tm = w._filoTabs;
  const url = (t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } };
  const davanti = tm.tabs.find((t) => t.id === tm.activeId);
  return { schede: tm.tabs.map(url), davanti: davanti ? url(davanti) : null };
});

const incognite = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((x) => !x.isDestroyed() && x._filoTabs && x._filoIncognito)
  .flatMap((w) => w._filoTabs.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } })));

const sessioneSalvata = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
  return (s && s.tabs) || [];
});

const CREDITI = /^filo:\/\/credits\//;

async function preparaEChiudi(app, shell, openTab, testServer, n, { crediti = false, attivaIndice = null } = {}) {
  const urls = [];
  for (let i = 0; i < n; i++) urls.push((await openTab(testServer.html(`<title>S${i}</title><h1>S${i}</h1>`))).url());
  if (crediti) urls.push((await openTab('filo://credits/credits.html')).url());
  if (attivaIndice != null) {
    await app.evaluate(({ BrowserWindow }, i) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
      const t = w._filoTabs.tabs.filter((x) => !String(x.url || '').startsWith('filo://newtab'))[i];
      w._filoTabs.activateTab(t.id);
    }, attivaIndice);
  }
  await expect.poll(() => sessioneSalvata(app), { timeout: 10000 }).toEqual(expect.arrayContaining(urls.filter((u) => !CREDITI.test(u))));
  await new Promise((r) => setTimeout(r, 1200));
  await shell.evaluate(() => window.filoShell.openIncognito());
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(() => normale(app), { timeout: 10000 }).toBeNull();
  return urls;
}

const contaCrediti = (s) => (s?.schede || []).filter((u) => CREDITI.test(u)).length;

test('molte schede salvate, attiva in mezzo: Crediti davanti e ci resta', async ({ app, shell, openTab, testServer }) => {
  const urls = await preparaEChiudi(app, shell, openTab, testServer, 5, { attivaIndice: 2 });
  await app.evaluate(({ app: x }) => { x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD2345'], process.cwd()); });
  await expect.poll(async () => (await normale(app))?.schede || [], { timeout: 20000 })
    .toEqual(expect.arrayContaining([...urls, expect.stringMatching(CREDITI)]));
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 500));
    expect((await normale(app)).davanti, `istante ${i}`).toMatch(CREDITI);
  }
  expect(await incognite(app), 'Crediti nell\'incognito').not.toEqual(expect.arrayContaining([expect.stringMatching(CREDITI)]));
  expect(contaCrediti(await normale(app))).toBe(1);
});

test('codice storto: Crediti davanti', async ({ app, shell, openTab, testServer }) => {
  await preparaEChiudi(app, shell, openTab, testServer, 2);
  await app.evaluate(({ app: x }) => { x.emit('second-instance', {}, ['filo.exe', 'filo://invito/'], process.cwd()); });
  await expect.poll(async () => (await normale(app))?.davanti || '', { timeout: 20000 }).toMatch(CREDITI);
  await new Promise((r) => setTimeout(r, 1500));
  expect((await normale(app)).davanti).toMatch(CREDITI);
});

test('due inviti di fila mentre la finestra rinasce', async ({ app, shell, openTab, testServer }) => {
  await preparaEChiudi(app, shell, openTab, testServer, 3);
  await app.evaluate(({ app: x }) => {
    x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD2345'], process.cwd());
    x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD2345'], process.cwd());
  });
  await expect.poll(async () => (await normale(app))?.davanti || '', { timeout: 20000 }).toMatch(CREDITI);
  await new Promise((r) => setTimeout(r, 1500));
  const s = await normale(app);
  expect(s.davanti).toMatch(CREDITI);
  console.log('DUE-INVITI crediti:', contaCrediti(s), JSON.stringify(s.schede));
});

test('due inviti di fila a finestra viva (confronto)', async ({ app }) => {
  await app.evaluate(({ app: x }) => {
    x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD2345'], process.cwd());
    x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD2345'], process.cwd());
  });
  await expect.poll(async () => (await normale(app))?.davanti || '', { timeout: 20000 }).toMatch(CREDITI);
  await new Promise((r) => setTimeout(r, 1500));
  console.log('VIVA crediti:', contaCrediti(await normale(app)));
});

test('Crediti già fra le schede salvate, non davanti', async ({ app, shell, openTab, testServer }) => {
  await preparaEChiudi(app, shell, openTab, testServer, 2, { crediti: true, attivaIndice: 0 });
  await app.evaluate(({ app: x }) => { x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD2345'], process.cwd()); });
  await expect.poll(async () => (await normale(app))?.davanti || '', { timeout: 20000 }).toMatch(CREDITI);
  await new Promise((r) => setTimeout(r, 1500));
  const s = await normale(app);
  expect(s.davanti).toMatch(CREDITI);
  console.log('GIA crediti:', contaCrediti(s), JSON.stringify(s.schede));
});

test('nessuna scheda salvata (solo la nuova scheda)', async ({ app, shell }) => {
  await new Promise((r) => setTimeout(r, 1500));
  await shell.evaluate(() => window.filoShell.openIncognito());
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(() => normale(app), { timeout: 10000 }).toBeNull();
  await app.evaluate(({ app: x }) => { x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD2345'], process.cwd()); });
  await expect.poll(async () => (await normale(app))?.davanti || '', { timeout: 20000 }).toMatch(CREDITI);
  await new Promise((r) => setTimeout(r, 1500));
  const s = await normale(app);
  expect(s.davanti).toMatch(CREDITI);
  console.log('VUOTA schede:', JSON.stringify(s.schede));
});
