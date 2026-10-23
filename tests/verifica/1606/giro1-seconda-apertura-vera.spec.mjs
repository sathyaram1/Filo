// #1606 verifica giro 1 — la seconda apertura VERA (un secondo processo, come dal collegamento), non l'evento finto.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { test, expect, argomentiScala } from '../../fixtures/electron.mjs';

const require = createRequire(import.meta.url);
const ELECTRON = require('electron');

async function secondaApertura(app, extra = []) {
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const cwd = await app.evaluate(() => process.cwd());
  return new Promise((ok) => {
    const p = spawn(ELECTRON, [...argomentiScala, ...extra, '.'], { cwd, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' }, stdio: 'ignore' });
    const t = setTimeout(() => { try { p.kill(); } catch (_) {} ok({ codice: 'appesa' }); }, 20000);
    p.on('exit', (codice) => { clearTimeout(t); ok({ codice }); });
  });
}

const sentinella = (app) => app.evaluate(() => {
  globalThis.__errori1606 = [];
  process.on('uncaughtException', (e) => globalThis.__errori1606.push(String(e && e.stack || e)));
});

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const vive = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const normali = vive.filter((w) => w._filoTabs && !w._filoIncognito);
  return {
    normali: normali.length,
    visibile: normali[0] ? normali[0].isVisible() : false,
    incognito: vive.filter((w) => w._filoIncognito).length,
    altre: vive.filter((w) => w.__altra1606).length,
    errori: globalThis.__errori1606 || [],
  };
});

const altraFinestra = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = new BrowserWindow({ width: 400, height: 400, show: true });
  w.__altra1606 = true;
  w.loadURL('data:text/html,<title>Accedi</title>passkey');
});

async function chiudiPrincipale(app, shell) {
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await stato(app)).normali, { timeout: 10000 }).toBe(0);
}

test('seconda apertura vera, con una finestrella aperta: torna la finestra, visibile, senza errori', async ({ app, shell }) => {
  await sentinella(app);
  await altraFinestra(app);
  await chiudiPrincipale(app, shell);
  const { codice } = await secondaApertura(app);
  expect(codice, 'la seconda copia deve uscire subito').toBe(0);
  await expect.poll(async () => (await stato(app)).normali, { timeout: 15000 }).toBe(1);
  const s = await stato(app);
  expect(s.visibile).toBe(true);
  expect(s.altre).toBe(1);
  expect(s.errori).toEqual([]);

  // Chiudi e riapri di nuovo: il riferimento rinnovato non deve tornare a puntare a una distrutta.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).close());
  await expect.poll(async () => (await stato(app)).normali, { timeout: 10000 }).toBe(0);
  expect((await secondaApertura(app)).codice).toBe(0);
  await expect.poll(async () => (await stato(app)).normali, { timeout: 15000 }).toBe(1);
  expect((await stato(app)).errori).toEqual([]);
});

test('due aperture insieme dal collegamento: una finestra sola', async ({ app, shell }) => {
  await sentinella(app);
  await altraFinestra(app);
  await chiudiPrincipale(app, shell);
  const esiti = await Promise.all([secondaApertura(app), secondaApertura(app), secondaApertura(app)]);
  expect(esiti.map((e) => e.codice)).toEqual([0, 0, 0]);
  await expect.poll(async () => (await stato(app)).normali, { timeout: 15000 }).toBe(1);
  await new Promise((r) => setTimeout(r, 1500));
  const s = await stato(app);
  expect(s.normali).toBe(1);
  expect(s.errori).toEqual([]);
});

test('resta aperta solo la finestra in incognito: la riapertura dà una finestra normale visibile', async ({ app, shell }) => {
  await sentinella(app);
  await app.evaluate(() => require('./window').createIncognitoWindow?.());
  await expect.poll(async () => (await stato(app)).incognito, { timeout: 10000 }).toBe(1);
  await chiudiPrincipale(app, shell);
  expect((await secondaApertura(app)).codice).toBe(0);
  await expect.poll(async () => (await stato(app)).normali, { timeout: 15000 }).toBe(1);
  const s = await stato(app);
  expect(s.visibile).toBe(true);
  expect(s.incognito).toBe(1);
  expect(s.errori).toEqual([]);
});

test('invito da fuori dopo la riapertura: Crediti si apre nella finestra rifatta', async ({ app, shell }) => {
  await sentinella(app);
  await altraFinestra(app);
  await chiudiPrincipale(app, shell);
  expect((await secondaApertura(app)).codice).toBe(0);
  await expect.poll(async () => (await stato(app)).normali, { timeout: 15000 }).toBe(1);
  expect((await secondaApertura(app, ['filo://invito/ABCD'])).codice).toBe(0);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
    return w ? w._filoTabs.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } }) : [];
  }), { timeout: 15000 }).toContainEqual(expect.stringMatching(/^filo:\/\/credits\//));
  expect((await stato(app)).errori).toEqual([]);
});
