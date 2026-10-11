// #685.1 giro 5, r2 — un campo in un'ombra chiusa appesa a un elemento qualunque (non a un componente col trattino):
// la ricerca negli appunti di Filo (tasto destro → freccetta di Incolla) e lo stesso schema su una pagina.

import { test, expect, argomentiScala } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apriCronologia, statoCronologia } from '../../helpers/cronologiaAppunti.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const urlAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t.view.webContents.getURL();
});
const premi = (app, keyCode, modifiers) => app.evaluate(({ BrowserWindow }, arg) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: arg.keyCode, modifiers: arg.modifiers });
  t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: arg.keyCode, modifiers: arg.modifiers });
}, { keyCode, modifiers });

for (const [nome, tasto, mod, mac] of [['Cmd+freccia sinistra su Mac', 'Left', ['meta'], true], ['Ctrl+Z', 'z', ['control'], false]]) {
  test(`r2 scrivendo nella ricerca degli appunti, ${nome} non porta via la pagina`, async ({ testServer }) => {
    const userData = cartellaTemporanea('filo-685-appunti-');
    writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: [
      { type: 'text', text: 'primo appunto', ts: Date.now() - 2000 },
      { type: 'text', text: 'secondo appunto', ts: Date.now() - 1000 },
    ] }), 'utf8');
    const a = testServer.html('<!doctype html><h1>A</h1>');
    const b = testServer.html('<!doctype html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea></body>');
    const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
    try {
      const shell = await app.firstWindow();
      await shell.waitForLoadState('domcontentloaded');
      await shell.evaluate((u) => window.filoShell.tabs.open(u), a);
      await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toBe(a);
      await app.evaluate(({ BrowserWindow }, u) => {
        const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
        w._filoTabs.navigate(w._filoTabs.activeId, u);
      }, b);
      await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toBe(b);
      const page = app.windows().find((w) => w.url() === b);
      await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
      if (mac) await app.evaluate(() => { Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true }); });
      const stato = await apriCronologia(app, page, '#ta');
      expect(stato.voci.length).toBe(2);
      await page.keyboard.type('secondo');
      await expect.poll(async () => (await statoCronologia(app, page))?.cerca?.valore, { timeout: 3000 }).toBe('secondo');
      await page.waitForTimeout(400);
      await premi(app, tasto, mod);
      await page.waitForTimeout(1500);
      expect(await urlAttiva(app)).toBe(b);
    } finally {
      await app.close().catch(() => {});
    }
  });
}

test('r2 campo in un\'ombra chiusa appesa a un div di una pagina: Cmd+freccia sinistra su Mac non porta via la pagina', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><h1>A</h1>');
  const b = testServer.html('<!doctype html><h1>B</h1><div id="h"></div><script>'
    + 'window.__o = document.getElementById("h").attachShadow({ mode: "closed" }); window.__o.innerHTML = "<input style=width:300px>";</script>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.navigate(w._filoTabs.activeId, u);
  }, b);
  await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toBe(b);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await app.evaluate(() => { Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true }); });
  await page.evaluate(() => window.__o.querySelector('input').focus());
  await page.keyboard.type('scrivo');
  expect(await page.evaluate(() => window.__o.querySelector('input').value)).toBe('scrivo');
  await premi(app, 'Left', ['meta']);
  await page.waitForTimeout(1200);
  expect(await urlAttiva(app)).toBe(b);
});
