// Verifica #2031.1 giro 1: l'invito da fuori con Filo senza finestra, sotto stress (due inviti insieme, tante schede).

import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const normale = (app) => app.evaluate(({ BrowserWindow }) => {
  const tutte = BrowserWindow.getAllWindows().filter((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
  const w = tutte[0];
  if (!w) return null;
  const tm = w._filoTabs;
  const url = (t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } };
  const davanti = tm.tabs.find((t) => t.id === tm.activeId);
  const visibili = tm.tabs.filter((t) => { try { return t.view.getVisible ? t.view.getVisible() : true; } catch (_) { return false; } }).map(url);
  return {
    finestre: tutte.length,
    visibile: w.isVisible(),
    schede: tm.tabs.map(url),
    davanti: davanti ? url(davanti) : null,
    visibili,
    crediti: tm.tabs.filter((t) => /^filo:\/\/credits\//.test(url(t))).length,
  };
});

const sessioneSalvata = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
  return (s && s.tabs) || [];
});

async function creditiSiVede(app, perche) {
  await expect.poll(async () => (await normale(app))?.davanti || '', { message: perche, timeout: 20000 }).toMatch(/^filo:\/\/credits\//);
  await new Promise((r) => setTimeout(r, 1500));
  const s = await normale(app);
  expect(s.finestre, `${perche}: una finestra sola`).toBe(1);
  expect(s.visibile, `${perche}: la finestra si vede`).toBe(true);
  expect(s.davanti, `${perche}: Crediti è finita dietro`).toMatch(/^filo:\/\/credits\//);
  expect(s.visibili.every((u) => /^filo:\/\/credits\//.test(u)), `${perche}: a schermo c'è altro oltre Crediti: ${s.visibili.join(', ')}`).toBe(true);
  return s;
}

test('due inviti insieme con Filo senza finestra: una finestra, Crediti davanti', async ({ app, shell, openTab, testServer }) => {
  const a = (await openTab(testServer.html('<title>A</title><h1>A</h1>'))).url();
  const b = (await openTab(testServer.html('<title>B</title><h1>B</h1>'))).url();
  await expect.poll(() => sessioneSalvata(app), { timeout: 10000 }).toEqual(expect.arrayContaining([a, b]));
  await shell.evaluate(() => window.filoShell.openIncognito());
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(() => normale(app), { timeout: 10000 }).toBeNull();

  await app.evaluate(({ app: x }) => {
    x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd());
    x.emit('open-url', { preventDefault() {} }, 'filo://invito/ABCD');
  });
  const s = await creditiSiVede(app, 'due inviti insieme');
  expect(s.schede).toEqual(expect.arrayContaining([a, b]));
  console.log('[stress] schede Crediti dopo due inviti:', s.crediti);
});

test('a Filo chiuso con trenta schede salvate, l\'invito dell\'avvio e uno durante la riapertura: Crediti davanti', async () => {
  const userData = cartellaTemporanea('filo-invito-stress-');
  const salvate = Array.from({ length: 30 }, (_, i) => `http://127.0.0.1:9/s${i}`);
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ sn_open_tabs: { tabs: salvate, activeIndex: 29 } }));
  const app = await electron.launch({
    args: [...argomentiScala, '.', 'filo://invito/ABCD'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test', FILO_TEST_ACCOLTO: '1' },
  });
  try {
    await app.evaluate(({ app: x }) => { x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()); });
    await expect.poll(async () => (await normale(app))?.schede.length || 0, { timeout: 30000 }).toBeGreaterThanOrEqual(31);
    const s = await creditiSiVede(app, 'avvio con trenta schede');
    console.log('[stress] schede Crediti all\'avvio:', s.crediti);
  } finally {
    await chiudiApp(app);
    togliCartella(userData);
  }
});
