// Verifica #2031.1, giro 1: l'invito aperto da fuori con Filo senza finestra principale, in sequenze insolite.

import { test, expect } from '../../fixtures/electron.mjs';

const normale = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
  if (!w) return null;
  const tm = w._filoTabs;
  const url = (t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } };
  const davanti = tm.tabs.find((t) => t.id === tm.activeId);
  return { schede: tm.tabs.map(url), davanti: davanti ? url(davanti) : null };
});

const sessioneSalvata = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
  return (s && s.tabs) || [];
});

const crediti = (schede) => schede.filter((u) => u.startsWith('filo://credits/')).length;

async function chiudi(app, shell, aperte) {
  await expect.poll(() => sessioneSalvata(app), { message: 'le schede aperte non sono state salvate', timeout: 10000 })
    .toEqual(expect.arrayContaining(aperte));
  await shell.evaluate(() => window.filoShell.openIncognito());
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(() => normale(app), { message: 'la finestra principale non si è chiusa', timeout: 10000 }).toBeNull();
}

const invito = (app) => app.evaluate(({ app: x }) => { x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()); });

async function creditiDavantiUnaVolta(app, attese, perche) {
  await expect.poll(async () => (await normale(app))?.schede || [], { message: perche, timeout: 15000 })
    .toEqual(expect.arrayContaining([...attese, expect.stringMatching(/^filo:\/\/credits\//)]));
  await new Promise((r) => setTimeout(r, 2000));
  const s = await normale(app);
  expect(s.davanti, `${perche}: Crediti è dietro`).toMatch(/^filo:\/\/credits\//);
  expect(crediti(s.schede), `${perche}: Crediti doppia`).toBe(1);
}

test('Crediti già fra le schede salvate, non attiva: l\'invito la porta davanti senza doppioni', async ({ app, shell, openTab, testServer }) => {
  await openTab('filo://credits/credits.html');
  const a = (await openTab(testServer.html('<title>A</title><h1>A</h1>'))).url();
  const b = (await openTab(testServer.html('<title>B</title><h1>B</h1>'))).url();
  await chiudi(app, shell, [a, b]);
  await invito(app);
  await creditiDavantiUnaVolta(app, [a, b], 'Crediti salvata dietro');
});

test('due inviti di fila mentre la finestra rinasce: Crediti una sola e davanti', async ({ app, shell, openTab, testServer }) => {
  const a = (await openTab(testServer.html('<title>A</title><h1>A</h1>'))).url();
  const b = (await openTab(testServer.html('<title>B</title><h1>B</h1>'))).url();
  await chiudi(app, shell, [a, b]);
  await invito(app);
  await app.evaluate(({ app: x }) => { x.emit('open-url', { preventDefault() {} }, 'filo://invito/ABCD'); });
  await creditiDavantiUnaVolta(app, [a, b], 'due inviti');
});

test('invito e subito una riapertura semplice: Crediti resta davanti', async ({ app, shell, openTab, testServer }) => {
  const a = (await openTab(testServer.html('<title>A</title><h1>A</h1>'))).url();
  const b = (await openTab(testServer.html('<title>B</title><h1>B</h1>'))).url();
  await chiudi(app, shell, [a, b]);
  await invito(app);
  await app.evaluate(({ app: x }) => { x.emit('second-instance', {}, ['filo.exe', '.'], process.cwd()); });
  await app.evaluate(({ app: x }) => { x.emit('activate', {}, true); });
  await creditiDavantiUnaVolta(app, [a, b], 'invito più riapertura');
});

test('otto schede salvate: Crediti resta davanti anche a riapertura finita', async ({ app, shell, openTab, testServer }) => {
  const aperte = [];
  for (let i = 0; i < 8; i++) aperte.push((await openTab(testServer.html(`<title>S${i}</title><h1>S${i}</h1>`))).url());
  await chiudi(app, shell, aperte);
  await invito(app);
  await creditiDavantiUnaVolta(app, aperte, 'otto schede');
});
