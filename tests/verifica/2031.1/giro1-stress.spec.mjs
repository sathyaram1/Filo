// Verifica #2031.1 giro 1: l'invito da fuori con Filo acceso senza finestra principale, strade e sequenze vicine.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, argomentiScala } from '../../fixtures/electron.mjs';

const require = createRequire(import.meta.url);
const ELECTRON = require('electron');
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const normale = (app) => app.evaluate(({ BrowserWindow }) => {
  const vive = BrowserWindow.getAllWindows().filter((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
  const w = vive[0];
  if (!w) return null;
  const tm = w._filoTabs;
  const url = (t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } };
  const davanti = tm.tabs.find((t) => t.id === tm.activeId);
  return { finestre: vive.length, visibile: w.isVisible(), schede: tm.tabs.map(url), davanti: davanti ? url(davanti) : null };
});

const sessioneSalvata = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
  return (s && s.tabs) || [];
});

async function chiudiLaPrincipale(app, shell, openTab, testServer, { conCrediti = false } = {}) {
  if (conCrediti) {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.openTab('filo://credits/credits.html');
    });
  }
  const a = (await openTab(testServer.html('<title>A</title><h1>A</h1>'))).url();
  const b = (await openTab(testServer.html('<title>B</title><h1>B</h1>'))).url();
  await expect.poll(() => sessioneSalvata(app), { message: 'le schede aperte non sono state salvate', timeout: 10000 })
    .toEqual(expect.arrayContaining([a, b]));
  await shell.evaluate(() => window.filoShell.openIncognito());
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(() => normale(app), { message: 'la finestra principale non si è chiusa', timeout: 10000 }).toBeNull();
  return { a, b };
}

async function creditiDavanti(app, attese, perche) {
  await expect.poll(async () => (await normale(app))?.schede || [], { message: perche, timeout: 20000 })
    .toEqual(expect.arrayContaining([...attese, expect.stringMatching(/^filo:\/\/credits\//)]));
  await new Promise((r) => setTimeout(r, 1500));
  const s = await normale(app);
  expect(s.davanti, `${perche}: Crediti non è davanti`).toMatch(/^filo:\/\/credits\//);
  expect(s.schede.filter((u) => u.startsWith('filo://credits/')).length, `${perche}: Crediti doppia`).toBe(1);
  expect(s.finestre, `${perche}: finestre doppie`).toBe(1);
  expect(s.visibile).toBe(true);
}

test('seconda copia vera di Filo col link d\'invito fra gli argomenti: Crediti davanti', async ({ app, shell, openTab, testServer }) => {
  const { a, b } = await chiudiLaPrincipale(app, shell, openTab, testServer);
  const userData = await app.evaluate(({ app: x }) => x.getPath('userData'));
  const uscita = await new Promise((ok) => {
    const p = spawn(ELECTRON, [...argomentiScala, '.', 'filo://invito/ABCD'], { cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' }, stdio: 'ignore' });
    const tetto = setTimeout(() => { try { p.kill(); } catch (_) {} ok('appesa'); }, 20000);
    p.on('exit', (c) => { clearTimeout(tetto); ok(c); });
  });
  expect(uscita).toBe(0);
  await creditiDavanti(app, [a, b], 'la seconda copia con l\'invito');
});

test('due inviti di fila mentre la finestra rinasce: una finestra, una Crediti, davanti', async ({ app, shell, openTab, testServer }) => {
  const { a, b } = await chiudiLaPrincipale(app, shell, openTab, testServer);
  await app.evaluate(({ app: x }) => {
    x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd());
    x.emit('open-url', { preventDefault() {} }, 'filo://invito/ABCD');
    x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd());
  });
  await creditiDavanti(app, [a, b], 'tre inviti di fila');
});

test('Crediti già fra le schede salvate, dietro: l\'invito la porta davanti senza doppione', async ({ app, shell, openTab, testServer }) => {
  const { a, b } = await chiudiLaPrincipale(app, shell, openTab, testServer, { conCrediti: true });
  await app.evaluate(({ app: x }) => { x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()); });
  await creditiDavanti(app, [a, b], 'Crediti salvata dietro');
});
